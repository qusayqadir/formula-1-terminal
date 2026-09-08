"""Always-on live stream worker (single EC2 box, systemd Restart=always).

This process runs 24/7 and self-gates on the OpenF1 calendar:

  • RACE session live now  -> subscribe to the OpenF1 MQTT firehose and fan each
    topic out to SQS (the real live path). Only `session_type == "Race"` counts —
    never Practice / Qualifying / Sprint / Sprint Qualifying.

  • No race live            -> loop-replay the bundled mock corpus
    (`mock_openf1_producer_messages_bahrain.json`) into the *same* SQS queues, with
    every timestamp rebased to "now" on each pass, so the dashboard shows a
    continuously-streaming demo session instead of a dead screen between races.

Both sources feed one asyncio buffer that a single `dispatcher` drains to SQS,
so the downstream consumers (timings / telemetry / session_events Lambdas) are
identical for live and mock — the only difference the frontend sees is which
`session_key` is current (live session vs the mock 10045), surfaced via the
`/api/v1/live/status` endpoint.

NOTE on the mock loop: rebasing timestamps to "now" makes the timestamp-keyed
tables (interval/position/car_data/location/weather) gain fresh rows every pass
(that's what creates the streaming feel). Left running for days that grows the
mock session unbounded — add a retention/TTL prune on `bronze.live_*` for
`session_key = 10045`, or stop the demo loop when no client is watching, if you
run this continuously. Lap/stint/pit rows are keyed by lap/stint number and just
upsert in place, so they don't grow.

Env:
    openf1_username / openf1_password    OpenF1 MQTT/token creds (live path)
    session_sqs_url / telemetry_sqs_url / timings_sqs_url   SQS queue URLs
    DATABASE_URL                         Postgres (bronze.live_focus_selection)
    AWS_REGION                (us-east-1)  SQS region
    SESSIONS_YEAR             (current)    year to query for the race calendar
    RACE_TAIL_BUFFER_MINUTES  (75)         keep streaming past scheduled end (red flags)
    MOCK_REPLAY_SECONDS       (600)        wall-clock length of one mock replay pass
    MOCK_MESSAGES_PATH        (bundled)    override the mock corpus location
"""
import asyncio
import json
import logging
import os
import ssl
import time
from datetime import datetime, timedelta, timezone
from typing import NamedTuple

import aiomqtt
import httpx
import psycopg
from psycopg.rows import dict_row
from aiobotocore.session import get_session
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def get_connection(**kwargs) -> psycopg.Connection:
    url = os.environ["DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://")
    return psycopg.connect(url, row_factory=dict_row, **kwargs)


REGION = os.environ.get("AWS_REGION", "us-east-1")

SESSION_SQS = os.environ["session_sqs_url"]
TELEMETRY_SQS = os.environ["telemetry_sqs_url"]
TIMINGS_SQS = os.environ["timings_sqs_url"]

# internal bucket -> SQS queue url
BUCKET_SQS = {
    "session_events": SESSION_SQS,
    "telemetry": TELEMETRY_SQS,
    "timings": TIMINGS_SQS,
}

TOPIC_BUCKET: dict[str, str] = {
    "v1/laps": "timings",
    "v1/intervals": "timings",
    "v1/position": "timings",

    "v1/car_data": "telemetry",
    "v1/location": "telemetry",

    "v1/stints": "session_events",
    "v1/pit": "session_events",
    "v1/race_control": "session_events",
    "v1/overtakes": "session_events",
    "v1/weather": "session_events",
    "v1/sessions": "session_events",
}


# ── self-gating / mock config ──────────────────────────────────────────────
SESSIONS_YEAR = int(os.environ.get("SESSIONS_YEAR", datetime.now(timezone.utc).year))
RACE_TAIL_BUFFER = float(os.environ.get("RACE_TAIL_BUFFER_MINUTES", "75")) * 60
MOCK_REPLAY_SECONDS = float(os.environ.get("MOCK_REPLAY_SECONDS", "600"))
MAX_GAP_SECONDS = 2.0
WINDOWS_REFRESH_SECONDS = 300        # re-fetch the race calendar at most this often
RACE_RECHECK_SECONDS = 20            # during a mock loop, how often to check for a live race

DEFAULT_MOCK_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "mock_openf1_producer_messages_bahrain.json",
)
MOCK_MESSAGES_PATH = os.environ.get("MOCK_MESSAGES_PATH", DEFAULT_MOCK_PATH)


FOCUS_REFRESH_SECONDS = 10
focus: dict[int, set[int]] = {}  # session_key -> {driver_number, ...}

_focus_conn: "psycopg.Connection | None" = None


def _get_focus_conn() -> psycopg.Connection:
    global _focus_conn
    if _focus_conn is None or _focus_conn.closed:
        _focus_conn = get_connection()
    return _focus_conn


def _reset_focus_conn() -> None:
    global _focus_conn
    if _focus_conn is not None and not _focus_conn.closed:
        try:
            _focus_conn.close()
        except Exception:
            pass
    _focus_conn = None


def _load_focus() -> dict[int, set[int]]:
    """Sync Postgres read of the current focus selection (runs off the event loop)."""
    try:
        conn = _get_focus_conn()
        rows = conn.execute(
            "SELECT session_key, driver_numbers FROM bronze.live_focus_selection"
        ).fetchall()
        conn.rollback()
        return {row["session_key"]: set(row["driver_numbers"] or ()) for row in rows}
    except Exception:
        _reset_focus_conn()
        raise


async def focus_refresher() -> None:
    """Refresh the in-memory focus map from bronze.live_focus_selection every ~10s."""
    global focus
    while True:
        try:
            focus = await asyncio.to_thread(_load_focus)
        except Exception:
            logger.exception("focus refresh failed; keeping previous selection")
        await asyncio.sleep(FOCUS_REFRESH_SECONDS)


openf1_token_username = os.environ["openf1_username"]
openf1_token_password = os.environ["openf1_password"]


async def get_access_token() -> str:
    async with httpx.AsyncClient(timeout=10) as http:
        resp = await http.post(
            "https://api.openf1.org/token",
            data={
                "username": openf1_token_username,
                "password": openf1_token_password,
            },
        )
        resp.raise_for_status()
        return resp.json()["access_token"]


# ── race-calendar gating ───────────────────────────────────────────────────
class RaceWindow(NamedTuple):
    session_key: int
    meeting_key: int | None
    start: float   # epoch seconds
    end: float     # epoch seconds (scheduled end + tail buffer)


_windows_cache: dict = {"at": 0.0, "data": []}


def _now() -> float:
    return datetime.now(timezone.utc).timestamp()


def _parse_ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return None


async def fetch_race_windows(http: httpx.AsyncClient) -> list[RaceWindow]:
    """Pull this year's Race sessions from the OpenF1 sessions API.

    Only `session_type == "Race"` — Practice / Qualifying / Sprint /
    Sprint Qualifying are deliberately excluded.
    """
    resp = await http.get(
        "https://api.openf1.org/v1/sessions",
        params={"year": SESSIONS_YEAR, "session_type": "Race"},
    )
    resp.raise_for_status()
    windows: list[RaceWindow] = []
    for s in resp.json():
        if s.get("session_type") != "Race":  # defend against loose server-side filtering
            continue
        start = _parse_ts(s.get("date_start"))
        end = _parse_ts(s.get("date_end"))
        if start is None or end is None:
            continue
        windows.append(RaceWindow(
            session_key=s["session_key"],
            meeting_key=s.get("meeting_key"),
            start=start,
            end=end + RACE_TAIL_BUFFER,
        ))
    return windows


async def race_window_now(http: httpx.AsyncClient) -> RaceWindow | None:
    """The race window currently in progress, or None. Caches the calendar."""
    if time.monotonic() - _windows_cache["at"] > WINDOWS_REFRESH_SECONDS:
        try:
            _windows_cache["data"] = await fetch_race_windows(http)
            _windows_cache["at"] = time.monotonic()
        except Exception:
            logger.exception("failed to refresh race calendar; using cached windows")
    now = _now()
    for w in _windows_cache["data"]:
        if w.start <= now <= w.end:
            return w
    return None


# ── mock replay helpers ────────────────────────────────────────────────────
def _event_time(record: dict) -> float:
    ts = record.get("date") or record.get("date_start")
    return _parse_ts(ts) or 0.0


def _solve_scale(deltas: list[float], target: float, max_gap: float) -> float:
    """Scale where sum(min(delta*scale, max_gap)) == target (see mock_message_producer)."""
    if target <= 0 or not deltas:
        return 0.0
    lo, hi = 0.0, 1.0
    while sum(min(d * hi, max_gap) for d in deltas) < target:
        hi *= 2
        if hi > 1e9:
            return hi
    for _ in range(60):
        mid = (lo + hi) / 2
        if sum(min(d * mid, max_gap) for d in deltas) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def load_mock_records(path: str = MOCK_MESSAGES_PATH) -> list[dict]:
    with open(path, "r", encoding="utf-8") as fh:
        payload = json.load(fh)
    records = payload.get("records", [])
    records.sort(key=lambda r: (_event_time(r), r.get("_id") or 0))
    logger.info("loaded %d mock records from %s", len(records), path)
    return records


def _rebased_payload(record: dict, offset: float) -> str:
    """Strip `_topic` and shift every timestamp field by `offset` seconds."""
    body = {k: v for k, v in record.items() if k != "_topic"}
    for key in ("date", "date_start", "date_end"):
        if body.get(key):
            try:
                body[key] = (datetime.fromisoformat(body[key]) + timedelta(seconds=offset)).isoformat()
            except ValueError:
                pass
    return json.dumps(body)


async def run_mock_replay(buffer: asyncio.Queue, http: httpx.AsyncClient) -> None:
    """Loop the mock corpus into SQS until a real race goes live.

    Each pass rebases the corpus so it 'starts now', giving the dashboard a
    live-looking, continuously-advancing demo session between races.
    """
    records = load_mock_records()
    if not records:
        logger.warning("mock corpus empty; sleeping instead of replaying")
        await asyncio.sleep(RACE_RECHECK_SECONDS)
        return

    times = [_event_time(r) for r in records]
    deltas = [max(times[i] - times[i - 1], 0.0) for i in range(1, len(times))]
    scale = _solve_scale(deltas, MOCK_REPLAY_SECONDS, MAX_GAP_SECONDS)
    logger.info("mock replay: %d records, ~%.0fs/pass (scale %.4f)",
                len(records), MOCK_REPLAY_SECONDS, scale)

    last_check = time.monotonic()
    while True:
        offset = _now() - times[0]          # rebase this pass to "now"
        prev = times[0]
        for record, t in zip(records, times):
            sleep = min(max((t - prev) * scale, 0.0), MAX_GAP_SECONDS)
            if sleep:
                await asyncio.sleep(sleep)
            prev = t

            # bail out to the live path the moment a race window opens
            if time.monotonic() - last_check > RACE_RECHECK_SECONDS:
                last_check = time.monotonic()
                if await race_window_now(http) is not None:
                    logger.info("race went live during mock replay — switching to OpenF1")
                    return

            bucket = TOPIC_BUCKET.get(record.get("_topic"))
            if bucket is None:
                continue
            await buffer.put((bucket, _rebased_payload(record, offset)))


# ── live OpenF1 path ───────────────────────────────────────────────────────
async def run_live_producer(buffer: asyncio.Queue, window: RaceWindow) -> None:
    """Subscribe to the OpenF1 MQTT firehose and stream to SQS until the race
    window ends. Reconnects with backoff on MQTT errors within the window."""
    backoff = 1
    while _now() < window.end:
        try:
            token = await get_access_token()
            async with aiomqtt.Client(
                hostname="mqtt.openf1.org",
                port=8883,
                username=openf1_token_username,
                password=token,
                tls_context=ssl.create_default_context(),
            ) as client:
                for topic in TOPIC_BUCKET.keys():
                    await client.subscribe(topic)
                logger.info("subscribed to %d OpenF1 topics for session %s",
                            len(TOPIC_BUCKET), window.session_key)
                backoff = 1

                messages = client.messages.__aiter__()
                while _now() < window.end:
                    # bounded wait so we can re-check the window end even if the
                    # firehose goes quiet (e.g. red flag, chequered flag).
                    try:
                        message = await asyncio.wait_for(messages.__anext__(), timeout=5.0)
                    except asyncio.TimeoutError:
                        continue
                    except StopAsyncIteration:
                        break

                    topic = str(message.topic)
                    bucket = TOPIC_BUCKET.get(topic)
                    if bucket is None:
                        continue
                    payload = message.payload.decode()

                    # car_data is the firehose: only forward focused drivers.
                    # Everything else (incl. v1/location for the full track map)
                    # passes through.
                    if topic == "v1/car_data":
                        try:
                            body = json.loads(payload)
                            if body["driver_number"] not in focus.get(body["session_key"], set()):
                                continue
                        except (json.JSONDecodeError, KeyError):
                            logger.warning("dropping malformed car_data payload")
                            continue

                    await buffer.put((bucket, payload))

        except aiomqtt.MqttError as exc:
            logger.warning("MQTT connection dropped (%s); reconnecting in %ss", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)

    logger.info("race window for session %s ended — reverting to mock", window.session_key)


async def supervisor(buffer: asyncio.Queue) -> None:
    """Top-level source selector: live OpenF1 during a Race, mock replay otherwise."""
    async with httpx.AsyncClient(timeout=15) as http:
        while True:
            try:
                window = await race_window_now(http)
                if window is not None:
                    logger.info("RACE live: session %s → streaming OpenF1 until %s",
                                window.session_key,
                                datetime.fromtimestamp(window.end, timezone.utc).isoformat())
                    await run_live_producer(buffer, window)
                else:
                    logger.info("no race live → streaming mock replay for the demo")
                    await run_mock_replay(buffer, http)
            except Exception:
                logger.exception("supervisor loop error; retrying in 10s")
                await asyncio.sleep(10)


async def dispatcher(buffer: asyncio.Queue, sqs) -> None:
    while True:
        queue, payload = await buffer.get()
        try:
            await sqs.send_message(QueueUrl=BUCKET_SQS[queue], MessageBody=payload)
        except Exception:
            logger.exception("failed to enqueue message for bucket %s", queue)
        finally:
            buffer.task_done()


async def main() -> None:
    buffer: asyncio.Queue = asyncio.Queue(maxsize=10000)
    session = get_session()
    async with session.create_client("sqs", region_name=REGION) as sqs:
        await asyncio.gather(
            focus_refresher(),
            supervisor(buffer),
            dispatcher(buffer, sqs),
        )


if __name__ == "__main__":
    asyncio.run(main())
