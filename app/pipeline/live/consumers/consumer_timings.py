# handles the lap segment data and the driver interval data
#  assuming lap segment data comes when its complete
# interval data come at 3.7Hz?
# position data comes in every 4 sec
import json
import logging

import psycopg

from core.database import get_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Reused across warm Lambda invocations; recreated if closed/broken.
_conn: "psycopg.Connection | None" = None


def get_conn() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed:
        _conn = get_connection()
    return _conn


def reset_conn() -> None:
    """Drop a poisoned connection so the next call reconnects cleanly."""
    global _conn
    if _conn is not None and not _conn.closed:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None

# get the +1 data, if getting lapped display to user
def num(value):

    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


SESSION_SQL = """
    INSERT INTO bronze.live_session (session_key, meeting_key)
    VALUES (%(session_key)s, %(meeting_key)s)
    ON CONFLICT (session_key) DO NOTHING
"""

LAP_SQL = """
    INSERT INTO bronze.live_lap (
        session_key, meeting_key, driver_number, lap_number, _key, _id,
        date_start, lap_duration,
        duration_sector_1, duration_sector_2, duration_sector_3,
        i1_speed, i2_speed, st_speed, is_pit_out_lap,
        segments_sector_1, segments_sector_2, segments_sector_3
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(lap_number)s, %(_key)s, %(_id)s,
        %(date_start)s, %(lap_duration)s,
        %(duration_sector_1)s, %(duration_sector_2)s, %(duration_sector_3)s,
        %(i1_speed)s, %(i2_speed)s, %(st_speed)s, %(is_pit_out_lap)s,
        %(segments_sector_1)s, %(segments_sector_2)s, %(segments_sector_3)s
    )
    ON CONFLICT (session_key, driver_number, lap_number) DO UPDATE SET
        _key              = EXCLUDED._key,
        _id               = GREATEST(bronze.live_lap._id, EXCLUDED._id),
        date_start        = COALESCE(EXCLUDED.date_start,        bronze.live_lap.date_start),
        lap_duration      = COALESCE(EXCLUDED.lap_duration,      bronze.live_lap.lap_duration),
        duration_sector_1 = COALESCE(EXCLUDED.duration_sector_1, bronze.live_lap.duration_sector_1),
        duration_sector_2 = COALESCE(EXCLUDED.duration_sector_2, bronze.live_lap.duration_sector_2),
        duration_sector_3 = COALESCE(EXCLUDED.duration_sector_3, bronze.live_lap.duration_sector_3),
        i1_speed          = COALESCE(EXCLUDED.i1_speed,          bronze.live_lap.i1_speed),
        i2_speed          = COALESCE(EXCLUDED.i2_speed,          bronze.live_lap.i2_speed),
        st_speed          = COALESCE(EXCLUDED.st_speed,          bronze.live_lap.st_speed),
        is_pit_out_lap    = COALESCE(EXCLUDED.is_pit_out_lap,    bronze.live_lap.is_pit_out_lap),
        segments_sector_1 = COALESCE(EXCLUDED.segments_sector_1, bronze.live_lap.segments_sector_1),
        segments_sector_2 = COALESCE(EXCLUDED.segments_sector_2, bronze.live_lap.segments_sector_2),
        segments_sector_3 = COALESCE(EXCLUDED.segments_sector_3, bronze.live_lap.segments_sector_3),
        ingested_at       = NOW()
"""

INTERVAL_SQL = """
    INSERT INTO bronze.live_interval (
        session_key, meeting_key, driver_number, date, gap_to_leader, "interval"
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(date)s,
        %(gap_to_leader)s, %(interval)s
    )
    ON CONFLICT (session_key, driver_number, date) DO UPDATE SET
        gap_to_leader = COALESCE(EXCLUDED.gap_to_leader, bronze.live_interval.gap_to_leader),
        "interval"    = COALESCE(EXCLUDED."interval",    bronze.live_interval."interval"),
        ingested_at   = NOW()
"""

POSITION_SQL = """
    INSERT INTO bronze.live_position (
        session_key, meeting_key, driver_number, date, position
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(date)s, %(position)s
    )
    ON CONFLICT (session_key, driver_number, date) DO NOTHING
"""

def ensure_session(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(SESSION_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
    })


def upsert_lap(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(LAP_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "lap_number": body["lap_number"],
        "_key": body.get("_key"),
        "_id": body.get("_id"),
        "date_start": body.get("date_start"),
        "lap_duration": num(body.get("lap_duration")),
        "duration_sector_1": num(body.get("duration_sector_1")),
        "duration_sector_2": num(body.get("duration_sector_2")),
        "duration_sector_3": num(body.get("duration_sector_3")),
        "i1_speed": body.get("i1_speed"),
        "i2_speed": body.get("i2_speed"),
        "st_speed": body.get("st_speed"),
        "is_pit_out_lap": body.get("is_pit_out_lap"),
        # psycopg adapts Python lists to INTEGER[]; None stays NULL
        "segments_sector_1": body.get("segments_sector_1"),
        "segments_sector_2": body.get("segments_sector_2"),
        "segments_sector_3": body.get("segments_sector_3"),
    })


def upsert_interval(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(INTERVAL_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "date": body.get("date") or body.get("date_start"),
        "gap_to_leader": num(body.get("gap_to_leader")),
        "interval": num(body.get("interval")),
    })

def upsert_position(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(POSITION_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "date": body.get("date") or body.get("date_start"),
        "position": body["position"],
    })

def process(conn: psycopg.Connection, body: dict) -> None:
    ensure_session(conn, body)
    if "lap_duration" in body:
        upsert_lap(conn, body)
    elif "position" in body:
        upsert_position(conn, body)
    else:
        upsert_interval(conn, body)


def handler(event, context=None):
    conn = get_conn()
    failures = []

    for record in event.get("Records", []):
        message_id = record.get("messageId")
        try:
            body = json.loads(record["body"])
            process(conn, body)
            conn.commit()
        except Exception:
            logger.exception("timings record failed: %s", message_id)
            try:
                conn.rollback()
            except Exception:
                reset_conn()
                conn = get_conn()
            if message_id:
                failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
