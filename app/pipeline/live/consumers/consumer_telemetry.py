# handles the car telemetry (v1/car_data) and track location (v1/location) streams
#  car_data ~= 3.7 samples/s/car (74 msg/s for 20 cars) -> filtered to focus drivers upstream
#  location ~= 3.7 samples/s/car, kept for all cars (drives the track map)
# both are complete snapshots keyed by (session_key, driver_number, date) -> DO NOTHING on conflict
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


SESSION_SQL = """
    INSERT INTO bronze.live_session (session_key, meeting_key)
    VALUES (%(session_key)s, %(meeting_key)s)
    ON CONFLICT (session_key) DO NOTHING
"""

# complete snapshot per message; a conflict is just an at-least-once redelivery -> DO NOTHING
CAR_DATA_SQL = """
    INSERT INTO bronze.live_car_data (
        session_key, meeting_key, driver_number, date,
        speed, rpm, n_gear, throttle, brake, drs
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(date)s,
        %(speed)s, %(rpm)s, %(n_gear)s, %(throttle)s, %(brake)s, %(drs)s
    )
    ON CONFLICT (session_key, driver_number, date) DO NOTHING
"""

LOCATION_SQL = """
    INSERT INTO bronze.live_location (
        session_key, meeting_key, driver_number, date, x, y, z
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(date)s,
        %(x)s, %(y)s, %(z)s
    )
    ON CONFLICT (session_key, driver_number, date) DO NOTHING
"""


def ensure_session(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(SESSION_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
    })


def upsert_car_data(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(CAR_DATA_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "date": body["date"],
        "speed": body.get("speed"),
        "rpm": body.get("rpm"),
        "n_gear": body.get("n_gear"),
        "throttle": body.get("throttle"),
        "brake": body.get("brake"),
        "drs": body.get("drs"),
    })


def upsert_location(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(LOCATION_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "date": body["date"],
        "x": body.get("x"),
        "y": body.get("y"),
        "z": body.get("z"),
    })


def process(conn: psycopg.Connection, body: dict) -> None:
    ensure_session(conn, body)           # both tables FK bronze.live_session
    if "rpm" in body:                    # only car_data carries rpm
        upsert_car_data(conn, body)
    else:
        upsert_location(conn, body)


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
            logger.exception("telemetry record failed: %s", message_id)
            try:
                conn.rollback()
            except Exception:
                reset_conn()
                conn = get_conn()
            if message_id:
                failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
