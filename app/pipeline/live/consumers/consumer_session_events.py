import json
import logging

import psycopg

from core.database import get_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_conn: "psycopg.Connection | None" = None


def get_conn() -> psycopg.Connection:
    global _conn
    if _conn is None or _conn.closed:
        _conn = get_connection()
    return _conn


def reset_conn() -> None:
    global _conn
    if _conn is not None and not _conn.closed:
        try:
            _conn.close()
        except Exception:
            pass
    _conn = None


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

SESSION_META_SQL = """
    INSERT INTO bronze.live_session (
        session_key, meeting_key, circuit_key, circuit_short_name,
        country_code, country_key, country_name, location,
        session_name, session_type, year,
        date_start, date_end, gmt_offset, is_cancelled
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(circuit_key)s, %(circuit_short_name)s,
        %(country_code)s, %(country_key)s, %(country_name)s, %(location)s,
        %(session_name)s, %(session_type)s, %(year)s,
        %(date_start)s, %(date_end)s, %(gmt_offset)s, %(is_cancelled)s
    )
    ON CONFLICT (session_key) DO UPDATE SET
        meeting_key        = COALESCE(EXCLUDED.meeting_key,        bronze.live_session.meeting_key),
        circuit_key        = COALESCE(EXCLUDED.circuit_key,        bronze.live_session.circuit_key),
        circuit_short_name = COALESCE(EXCLUDED.circuit_short_name, bronze.live_session.circuit_short_name),
        country_code       = COALESCE(EXCLUDED.country_code,        bronze.live_session.country_code),
        country_key        = COALESCE(EXCLUDED.country_key,         bronze.live_session.country_key),
        country_name       = COALESCE(EXCLUDED.country_name,        bronze.live_session.country_name),
        location           = COALESCE(EXCLUDED.location,            bronze.live_session.location),
        session_name       = COALESCE(EXCLUDED.session_name,        bronze.live_session.session_name),
        session_type       = COALESCE(EXCLUDED.session_type,        bronze.live_session.session_type),
        year               = COALESCE(EXCLUDED.year,                bronze.live_session.year),
        date_start         = COALESCE(EXCLUDED.date_start,          bronze.live_session.date_start),
        date_end           = COALESCE(EXCLUDED.date_end,            bronze.live_session.date_end),
        gmt_offset         = COALESCE(EXCLUDED.gmt_offset,          bronze.live_session.gmt_offset),
        is_cancelled       = COALESCE(EXCLUDED.is_cancelled,        bronze.live_session.is_cancelled)
"""

RACE_CONTROL_SQL = """
    INSERT INTO bronze.live_race_control (
        session_key, meeting_key, date, category, flag, scope, message,
        driver_number, lap_number, sector, qualifying_phase
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(date)s, %(category)s, %(flag)s, %(scope)s, %(message)s,
        %(driver_number)s, %(lap_number)s, %(sector)s, %(qualifying_phase)s
    )
    ON CONFLICT (session_key, date, message) DO NOTHING
"""

OVERTAKES_SQL = """
    INSERT INTO bronze.live_overtake (
        session_key, meeting_key, date,
        overtaking_driver_number, overtaken_driver_number, position
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(date)s,
        %(overtaking_driver_number)s, %(overtaken_driver_number)s, %(position)s
    )
    ON CONFLICT (session_key, date, overtaking_driver_number, overtaken_driver_number) DO NOTHING
"""

PIT_SQL = """
    INSERT INTO bronze.live_pit (
        session_key, meeting_key, driver_number, date, lap_number,
        pit_duration, lane_duration, stop_duration
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(date)s, %(lap_number)s,
        %(pit_duration)s, %(lane_duration)s, %(stop_duration)s
    )
    ON CONFLICT (session_key, driver_number, lap_number) DO UPDATE SET
        date          = COALESCE(EXCLUDED.date,          bronze.live_pit.date),
        pit_duration  = COALESCE(EXCLUDED.pit_duration,  bronze.live_pit.pit_duration),
        lane_duration = COALESCE(EXCLUDED.lane_duration, bronze.live_pit.lane_duration),
        stop_duration = COALESCE(EXCLUDED.stop_duration, bronze.live_pit.stop_duration),
        ingested_at   = NOW()
"""

STINTS_SQL = """
    INSERT INTO bronze.live_stint (
        session_key, meeting_key, driver_number, stint_number,
        compound, lap_start, lap_end, tyre_age_at_start
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(driver_number)s, %(stint_number)s,
        %(compound)s, %(lap_start)s, %(lap_end)s, %(tyre_age_at_start)s
    )
    ON CONFLICT (session_key, driver_number, stint_number) DO UPDATE SET
        compound          = COALESCE(EXCLUDED.compound,          bronze.live_stint.compound),
        lap_start         = COALESCE(EXCLUDED.lap_start,         bronze.live_stint.lap_start),
        lap_end           = GREATEST(bronze.live_stint.lap_end,  EXCLUDED.lap_end),
        tyre_age_at_start = COALESCE(EXCLUDED.tyre_age_at_start, bronze.live_stint.tyre_age_at_start),
        ingested_at       = NOW()
"""

WEATHER_SQL = """
    INSERT INTO bronze.live_weather (
        session_key, meeting_key, date,
        air_temperature, track_temperature, humidity, pressure,
        rainfall, wind_direction, wind_speed
    ) VALUES (
        %(session_key)s, %(meeting_key)s, %(date)s,
        %(air_temperature)s, %(track_temperature)s, %(humidity)s, %(pressure)s,
        %(rainfall)s, %(wind_direction)s, %(wind_speed)s
    )
    ON CONFLICT (session_key, date) DO NOTHING
"""


def ensure_session(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(SESSION_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
    })


def upsert_session(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(SESSION_META_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "circuit_key": body.get("circuit_key"),
        "circuit_short_name": body.get("circuit_short_name"),
        "country_code": body.get("country_code"),
        "country_key": body.get("country_key"),
        "country_name": body.get("country_name"),
        "location": body.get("location"),
        "session_name": body.get("session_name"),
        "session_type": body.get("session_type"),
        "year": body.get("year"),
        "date_start": body.get("date_start"),
        "date_end": body.get("date_end"),
        "gmt_offset": body.get("gmt_offset"),
        "is_cancelled": body.get("is_cancelled"),
    })


def upsert_race_control(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(RACE_CONTROL_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "date": body["date"],
        "category": body.get("category"),
        "flag": body.get("flag"),
        "scope": body.get("scope"),
        "message": body["message"],
        "driver_number": body.get("driver_number"),
        "lap_number": body.get("lap_number"),
        "sector": body.get("sector"),
        "qualifying_phase": body.get("qualifying_phase"),
    })


def upsert_overtakes(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(OVERTAKES_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "date": body["date"],
        "overtaking_driver_number": body["overtaking_driver_number"],
        "overtaken_driver_number": body["overtaken_driver_number"],
        "position": body.get("position"),
    })


def upsert_pit(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(PIT_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "date": body.get("date"),
        "lap_number": body["lap_number"],
        "pit_duration": num(body.get("pit_duration")),
        "lane_duration": num(body.get("lane_duration")),
        "stop_duration": num(body.get("stop_duration")),
    })


def upsert_stints(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(STINTS_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "driver_number": body["driver_number"],
        "stint_number": body["stint_number"],
        "compound": body.get("compound"),
        "lap_start": body.get("lap_start"),
        "lap_end": body.get("lap_end"),
        "tyre_age_at_start": body.get("tyre_age_at_start"),
    })


def upsert_weather(conn: psycopg.Connection, body: dict) -> None:
    conn.execute(WEATHER_SQL, {
        "session_key": body["session_key"],
        "meeting_key": body["meeting_key"],
        "date": body["date"],
        "air_temperature": num(body.get("air_temperature")),
        "track_temperature": num(body.get("track_temperature")),
        "humidity": body.get("humidity"),
        "pressure": num(body.get("pressure")),
        "rainfall": body.get("rainfall"),
        "wind_direction": body.get("wind_direction"),
        "wind_speed": num(body.get("wind_speed")),
    })


def process(conn: psycopg.Connection, body: dict) -> None:
    # The `sessions` topic carries the session's own metadata — it has no
    # message/overtake/stint/pit/weather fields, so it must be routed first;
    # otherwise it falls through to weather and fails on the missing `date`.
    if "session_name" in body or "session_type" in body:
        upsert_session(conn, body)
        return

    ensure_session(conn, body)
    if "message" in body:
        upsert_race_control(conn, body)
    elif "overtaking_driver_number" in body:
        upsert_overtakes(conn, body)
    elif "stint_number" in body:
        upsert_stints(conn, body)
    elif "pit_duration" in body:
        upsert_pit(conn, body)
    else:
        upsert_weather(conn, body)


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
            logger.exception("session_events record failed: %s", message_id)
            try:
                conn.rollback()
            except Exception:
                reset_conn()
                conn = get_conn()
            if message_id:
                failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
