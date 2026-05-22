import json
import os
import shutil
import re
import sqlite3
import time
import calendar
from contextlib import contextmanager
from datetime import datetime
from urllib.parse import urljoin, urlparse

import click
from flask import Flask, flash, g, jsonify, redirect, render_template, request, send_file, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from config import get_config_class, validate_config
from db import (
    DatabaseBusyError,
    checkpoint_wal,
    create_timestamped_backup,
    ensure_parent_directory,
    get_db_connection,
    get_file_size,
    get_friendly_database_error_message,
    list_backup_files,
    maintain_wal,
    managed_db,
    managed_db_readonly,
    vacuum_database,
)
from auth import (
    authenticate_user,
    create_user,
    delete_user,
    ensure_seed_admin,
    get_or_create_csrf_token,
    get_role_permissions,
    get_user_by_id,
    init_auth_db,
    list_users,
    login_required,
    login_user,
    logout_user,
    reset_user_password,
    role_required,
    serialize_user,
    update_user_role,
    validate_csrf_token,
)
from export_disconnected_fragments import build_disconnected_fragments_workbook
from export_interruption import build_interruption_workbook
from new_interruption import create_interruption_payload
from parser import (
    ValidationError,
    build_network_from_points,
    finalize_validation,
    make_validation,
    merge_validations,
    parse_kml_overlay_file,
    parse_uploaded_file,
    parse_xlsx_account_file,
)

app = Flask(__name__)
APP_BOOTSTRAPPED = False

LATEST_NETWORK_TOWERS = []
SEED_ADMIN_INFO = {"created": False, "username": "admin", "password": None}
LAST_AUDIT_PRUNE_TS = 0.0
LAST_WAL_MAINTENANCE_TS = 0.0
ACCOUNT_QUERY_CACHE = {}
ACCOUNT_QUERY_CACHE_LIMIT = 4
KML_FEATURE_CACHE = {}
KML_FEATURE_CACHE_LIMIT = 4
ACCOUNT_QUERY_RESULT_LIMIT = 500
ACCOUNT_SEARCH_RESULT_CACHE_LIMIT = 24
ACCOUNT_NUMBER_PATTERN = re.compile(r"\b\d{2}-\d{4}-\d{4}\b")
FEEDER_SUBSTATION_RULES = [
    ({"F11", "F12", "F13", "F14"}, {"TAL"}, "Talavera"),
    ({"F24", "F25"}, {"MNZ", "MUNOZ", "MUNOZNEW", "MUÑOZ"}, "Munoz New"),
    ({"F21", "F22", "F23"}, {"MNZ", "MUNOZ", "MUNOZOLD", "MUÑOZ"}, "Munoz Old"),
    ({"F41", "F42", "F43"}, {"GBA", "GUIMBA"}, "Guimba"),
    ({"F71", "F72"}, {"LPO", "LUPAO"}, "Lupao"),
    ({"F61", "F62"}, {"ALG", "ALIAGA"}, "Aliaga"),
    ({"F31", "F32", "F33"}, {"QZN", "QUEZON"}, "Quezon"),
]
INTERRUPTION_CAUSES = [
    "human being",
    "lightning",
    "major storm disaster",
    "scheduled",
    "trees",
    "overload",
    "error",
    "supply",
    "equipment",
    "other",
    "unknown",
    "earthquake",
]


def _get_table_columns(connection, table_name):
    rows = connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    return {row["name"] for row in rows}


def _ensure_table_column(connection, table_name, column_name, definition):
    existing_columns = _get_table_columns(connection, table_name)
    if column_name not in existing_columns:
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def create_app(config_object=None):
    global APP_BOOTSTRAPPED, SEED_ADMIN_INFO
    if config_object:
        app.config.from_object(config_object)
    elif not app.config.get("OUTAGE_ENV"):
        app.config.from_object(get_config_class())
    validate_config(app.config)
    if APP_BOOTSTRAPPED:
        return app

    initialize_app(app)
    APP_BOOTSTRAPPED = True
    return app


def configure_runtime_safety(flask_app):
    if flask_app.config.get("USE_PROXY_FIX") and not getattr(flask_app, "_outage_proxy_fix_enabled", False):
        flask_app.wsgi_app = ProxyFix(
            flask_app.wsgi_app,
            x_for=max(0, int(flask_app.config.get("PROXY_FIX_X_FOR", 1) or 0)),
            x_proto=max(0, int(flask_app.config.get("PROXY_FIX_X_PROTO", 1) or 0)),
            x_host=max(0, int(flask_app.config.get("PROXY_FIX_X_HOST", 1) or 0)),
        )
        flask_app._outage_proxy_fix_enabled = True


def initialize_app(flask_app):
    global SEED_ADMIN_INFO
    configure_runtime_safety(flask_app)
    ensure_parent_directory(flask_app.config["AUTH_DB_PATH"])
    os.makedirs(flask_app.config["BACKUP_DIR"], exist_ok=True)
    os.makedirs(flask_app.config["WORKSPACE_CACHE_DIR"], exist_ok=True)
    init_auth_db(flask_app.config["AUTH_DB_PATH"])
    init_interruptions_db(flask_app.config["AUTH_DB_PATH"])
    backfill_interruption_summary_columns(flask_app.config["AUTH_DB_PATH"])
    init_audit_logs_db(flask_app.config["AUTH_DB_PATH"])
    init_user_workspace_db(flask_app.config["AUTH_DB_PATH"])
    prune_audit_logs(force=True)
    if flask_app.config["AUTO_SEED_ADMIN"]:
        SEED_ADMIN_INFO = ensure_seed_admin(
            flask_app.config["AUTH_DB_PATH"],
            username=flask_app.config["SEED_ADMIN_USERNAME"],
            password=flask_app.config["SEED_ADMIN_PASSWORD"],
        )
        if SEED_ADMIN_INFO.get("created") and flask_app.config["IS_DEVELOPMENT"] and flask_app.config["SHOW_SEEDED_ADMIN_CREDENTIALS"]:
            print(
                "[auth] Seeded default admin account "
                f"username='{SEED_ADMIN_INFO['username']}' password='{SEED_ADMIN_INFO['password']}'. "
                "Change it after first login."
            )


@contextmanager
def get_app_db_connection():
    with managed_db(
        app.config["AUTH_DB_PATH"],
        busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"],
    ) as connection:
        yield connection


@contextmanager
def get_app_db_read_connection():
    with managed_db_readonly(
        app.config["AUTH_DB_PATH"],
        busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"],
    ) as connection:
        yield connection


def init_interruptions_db(db_path):
    with managed_db(db_path, busy_timeout_ms=app.config.get("SQLITE_BUSY_TIMEOUT_MS", 10000)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS interruptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                start_date TEXT,
                start_time TEXT,
                end_date TEXT,
                end_time TEXT,
                context_type TEXT,
                target_name TEXT,
                source_tower_clicked TEXT,
                clicked_tower_json TEXT,
                clicked_line_index INTEGER,
                affected_towers_json TEXT NOT NULL DEFAULT '[]',
                matched_rows_json TEXT NOT NULL DEFAULT '[]',
                line_indexes_json TEXT NOT NULL DEFAULT '[]',
                tower_indexes_json TEXT NOT NULL DEFAULT '[]',
                kml_feature_ids_json TEXT NOT NULL DEFAULT '[]',
                kml_feature_json TEXT,
                audit_json TEXT,
                feeder_name TEXT,
                affected_poles_count INTEGER NOT NULL DEFAULT 0,
                affected_accounts_count INTEGER NOT NULL DEFAULT 0,
                matched_rows_count INTEGER NOT NULL DEFAULT 0,
                trace_confidence TEXT NOT NULL DEFAULT 'confirmed',
                monitoring_status TEXT NOT NULL DEFAULT 'active',
                action_taken TEXT NOT NULL DEFAULT '',
                restored_date TEXT NOT NULL DEFAULT '',
                restored_time TEXT NOT NULL DEFAULT '',
                cause_of_interruption TEXT NOT NULL DEFAULT 'unknown',
                remarks TEXT NOT NULL DEFAULT '',
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        _ensure_table_column(connection, "interruptions", "affected_poles_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_table_column(connection, "interruptions", "affected_accounts_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_table_column(connection, "interruptions", "matched_rows_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_table_column(connection, "interruptions", "trace_confidence", "TEXT NOT NULL DEFAULT 'confirmed'")
        _ensure_table_column(connection, "interruptions", "monitoring_status", "TEXT NOT NULL DEFAULT 'active'")
        _ensure_table_column(connection, "interruptions", "action_taken", "TEXT NOT NULL DEFAULT ''")
        _ensure_table_column(connection, "interruptions", "restored_date", "TEXT NOT NULL DEFAULT ''")
        _ensure_table_column(connection, "interruptions", "restored_time", "TEXT NOT NULL DEFAULT ''")
        _ensure_table_column(connection, "interruptions", "cause_of_interruption", "TEXT NOT NULL DEFAULT 'unknown'")
        _ensure_table_column(connection, "interruptions", "remarks", "TEXT NOT NULL DEFAULT ''")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_interruptions_created_at ON interruptions(datetime(created_at) DESC, id DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_interruptions_created_by ON interruptions(created_by)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_interruptions_trace_confidence ON interruptions(trace_confidence)"
        )


def init_audit_logs_db(db_path):
    with managed_db(db_path, busy_timeout_ms=app.config.get("SQLITE_BUSY_TIMEOUT_MS", 10000)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                username TEXT NOT NULL,
                role TEXT NOT NULL,
                action_type TEXT NOT NULL,
                details_json TEXT NOT NULL DEFAULT '{}'
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_username_timestamp ON audit_logs(username, timestamp DESC, id DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_audit_logs_action_timestamp ON audit_logs(action_type, timestamp DESC, id DESC)"
        )


def init_user_workspace_db(db_path):
    with managed_db(db_path, busy_timeout_ms=app.config.get("SQLITE_BUSY_TIMEOUT_MS", 10000)) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_workspace (
                user_id INTEGER PRIMARY KEY,
                feeder_file_name TEXT,
                network_json TEXT,
                feeder_validation_json TEXT,
                account_data_json TEXT,
                xlsx_validation_json TEXT,
                kml_overlay_json TEXT,
                kml_validation_json TEXT,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def backfill_interruption_summary_columns(db_path, limit=500):
    with managed_db(db_path, busy_timeout_ms=app.config.get("SQLITE_BUSY_TIMEOUT_MS", 10000)) as connection:
        rows = connection.execute(
            """
            SELECT id, affected_towers_json, matched_rows_json, audit_json, trace_confidence
            FROM interruptions
            WHERE affected_poles_count = 0
               OR affected_accounts_count = 0
               OR matched_rows_count = 0
               OR trace_confidence IS NULL
               OR trace_confidence = ''
            ORDER BY id ASC
            LIMIT ?
            """,
            (int(limit),),
        ).fetchall()
        for row in rows:
            affected_towers = _json_loads(row["affected_towers_json"], [])
            matched_rows = _json_loads(row["matched_rows_json"], [])
            audit = _json_loads(row["audit_json"], {})
            connection.execute(
                """
                UPDATE interruptions
                SET affected_poles_count = ?,
                    affected_accounts_count = ?,
                    matched_rows_count = ?,
                    trace_confidence = ?
                WHERE id = ?
                """,
                (
                    _count_affected_pol_ids(affected_towers),
                    _count_unique_accounts(matched_rows),
                    len(matched_rows) if isinstance(matched_rows, list) else 0,
                    (audit or {}).get("trace_confidence", "confirmed"),
                    row["id"],
                ),
            )


def _json_dumps(value, default, compact=False):
    payload = value if value is not None else default
    if compact:
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(payload, ensure_ascii=False)


def _json_loads(value, default):
    if not value:
        return default
    try:
        return json.loads(value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return default


def _extract_pol_id(value):
    match = re.search(r"\b(?:SDO|TAL|ALG|MNZ|QZN|LPO|GBA)\d+\b", str(value or "").upper())
    return match.group(0) if match else ""


def _canonical_pol_id(value):
    normalized = str(value or "").strip().upper()
    return _extract_pol_id(normalized) or normalized


def _count_affected_pol_ids(towers):
    seen = set()
    for tower in towers or []:
        name = tower.get("name", "") if isinstance(tower, dict) else tower
        pole_id = _canonical_pol_id(name)
        if pole_id:
            seen.add(pole_id)
    return len(seen)


def _count_unique_accounts(rows):
    seen = set()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        account_number = str(row.get("account_number") or "").strip()
        if account_number:
            seen.add(account_number)
    return len(seen)


def _interruption_summary_counts(row, affected_towers=None, matched_rows=None):
    affected_poles_count = int(row["affected_poles_count"] or 0) if row and "affected_poles_count" in row.keys() else 0
    affected_accounts_count = int(row["affected_accounts_count"] or 0) if row and "affected_accounts_count" in row.keys() else 0
    matched_rows_count = int(row["matched_rows_count"] or 0) if row and "matched_rows_count" in row.keys() else 0

    if not affected_poles_count and affected_towers is not None:
        affected_poles_count = _count_affected_pol_ids(affected_towers)
    if not affected_accounts_count and matched_rows is not None:
        affected_accounts_count = _count_unique_accounts(matched_rows)
    if not matched_rows_count and matched_rows is not None:
        matched_rows_count = len(matched_rows)

    return {
        "totalPolId": affected_poles_count,
        "totalAffectedAccounts": affected_accounts_count,
        "matchedRowsCount": matched_rows_count,
    }


def _normalize_feeder_text(value):
    return re.sub(r"[^A-Z0-9]+", " ", str(value or "").upper()).strip()


def infer_feeder_code(feeder_name):
    text = _normalize_feeder_text(feeder_name)
    match = re.search(r"\bF\s*0?(\d{2})\b", text)
    if not match:
        match = re.search(r"\b0?(\d{2})\b", text)
    return f"F{match.group(1)}" if match else ""


def infer_substation_name(feeder_name):
    text = _normalize_feeder_text(feeder_name)
    compact_text = text.replace(" ", "")
    feeder_code = infer_feeder_code(text)
    for feeder_codes, aliases, substation_name in FEEDER_SUBSTATION_RULES:
        has_code = feeder_code in feeder_codes
        has_alias = any(alias in text.split() or alias in compact_text for alias in aliases)
        if has_code and has_alias:
            return substation_name
    for feeder_codes, _, substation_name in FEEDER_SUBSTATION_RULES:
        if feeder_code in feeder_codes:
            return substation_name
    return "Unidentified"


def _parse_local_datetime(date_value, time_value):
    date_text = str(date_value or "").strip()
    time_text = str(time_value or "").strip()
    if not date_text:
        return None
    for candidate in (
        f"{date_text} {time_text or '00:00'}",
        f"{date_text} {time_text or '00:00'}:00",
    ):
        for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(candidate, fmt)
            except ValueError:
                continue
    return None


def normalize_monitoring_status(value, *, start_date="", start_time="", restored_date="", restored_time=""):
    status = str(value or "").strip().lower()
    start_dt = _parse_local_datetime(start_date, start_time)
    restored_dt = _parse_local_datetime(restored_date, restored_time)
    now = datetime.now()
    if status == "restored":
        return "restored"
    if status == "scheduled":
        return "scheduled" if start_dt and start_dt > now else "active"
    if status == "active":
        return "active"
    if restored_dt and restored_dt <= now:
        return "restored"
    if start_dt and start_dt > now:
        return "scheduled"
    return "active"


def normalize_interruption_cause(value, default="unknown"):
    normalized = str(value or"").strip().lower()
    return normalized if normalized in INTERRUPTION_CAUSES else default


def normalize_monitoring_fields(payload, existing=None):
    existing = existing or {}
    previous_status = str(existing.get("status") or "").strip().lower()
    requested_status = str(payload.get("status") or payload.get("monitoring_status") or "").strip().lower()
    status = normalize_monitoring_status(
        payload.get("status") or payload.get("monitoring_status") or existing.get("status"),
        start_date=payload.get("start_date") or existing.get("startDate") or "",
        start_time=payload.get("start_time") or existing.get("startTime") or "",
        restored_date=payload.get("restored_date") or existing.get("restoredDate") or "",
        restored_time=payload.get("restored_time") or existing.get("restoredTime") or "",
    )
    action_taken = str(payload.get("action_taken") if payload.get("action_taken") is not None else existing.get("actionTaken", "")).strip()
    restored_date = str(
        payload.get("restored_date")
        if payload.get("restored_date") is not None
        else existing.get("restoredDate", "")
    ).strip()
    restored_time = str(
        payload.get("restored_time")
        if payload.get("restored_time") is not None
        else existing.get("restoredTime", "")
    ).strip()
    remarks = str(payload.get("remarks") if payload.get("remarks") is not None else existing.get("remarks", "")).strip()
    cause_of_interruption = normalize_interruption_cause(
        payload.get("cause_of_interruption")
        if payload.get("cause_of_interruption") is not None
        else existing.get("causeOfInterruption", "unknown")
    )
        
    if status == "restored" and not action_taken:
        action_taken = "Restored"
    if action_taken and status != "restored":
        status = "restored"
    has_explicit_restored_date = payload.get("restored_date") is not None
    has_explicit_restored_time = payload.get("restored_time") is not None
    if (
        status == "restored"
        and previous_status != "restored"
        and requested_status == "restored"
        and not has_explicit_restored_date
        and not has_explicit_restored_time
    ):
        now = datetime.now()
        restored_date = now.strftime("%Y-%m-%d")
        restored_time = now.strftime("%H:%M")
    if (status == "restored" or action_taken) and (not restored_date or not restored_time):
        now = datetime.now()
        restored_date = restored_date or now.strftime("%Y-%m-%d")
        restored_time = restored_time or now.strftime("%H:%M")
    if status != "restored" and not action_taken:
        restored_date = ""
        restored_time = ""

    return {
        "status": status,
        "actionTaken": action_taken,
        "restoredDate": restored_date,
        "restoredTime": restored_time,
        "remarks": remarks,
    }


def _sum_kwhr(rows):
    total = 0.0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            total += float(row.get("kwhr") or 0)
        except (TypeError, ValueError):
            continue
    return total


def _format_number(value, places=2):
    numeric = float(value or 0)
    if abs(numeric - round(numeric)) < 0.00001:
        return f"{int(round(numeric)):,}"
    return f"{numeric:,.{places}f}"


def _duration_loss_metrics(start_dt, duration_minutes, rows, dsm_rate=2.0148):
    if not start_dt or not isinstance(duration_minutes, int) or duration_minutes <= 0:
        return {"kwhr_loss": 0.0, "revenue_loss": 0.0}
    total_kwhr = _sum_kwhr(rows)
    if total_kwhr <= 0:
        return {"kwhr_loss": 0.0, "revenue_loss": 0.0}
    days_in_month = calendar.monthrange(start_dt.year, start_dt.month)[1]
    kwhr_loss = (((total_kwhr / days_in_month) / 24) / 60) * duration_minutes
    return {
        "kwhr_loss": round(kwhr_loss, 4),
        "revenue_loss": round(kwhr_loss * float(dsm_rate or 0), 4),
    }


def _dashboard_duration_minutes(status, start_dt, restored_dt, now):
    if not start_dt:
        return ""
    if status == "scheduled" and start_dt > now:
        return ""
    end_dt = restored_dt if status == "restored" and restored_dt else now
    if end_dt < start_dt:
        return ""
    return int((end_dt - start_dt).total_seconds() // 60)


def _clean_area_text(value):
    text = re.sub(r"\s+", " ", str(value or "")).strip(" ,")
    return text


def _extract_barangay_from_address(address):
    text = _clean_area_text(address)
    if not text:
        return ""
    match = re.search(r"\b(?:BRGY|BARANGAY)\.?\s+([^,;]+)", text, flags=re.IGNORECASE)
    if match:
        return _clean_area_text(match.group(1)).title()
    parts = [_clean_area_text(part) for part in re.split(r"[,;]", text) if _clean_area_text(part)]
    if len(parts) >= 2:
        return parts[-2].title()
    return parts[0].title() if parts else ""


def infer_affected_area(record):
    area_counts = {}
    for row in record.get("matchedRows") or []:
        if not isinstance(row, dict):
            continue
        area = _extract_barangay_from_address(row.get("address"))
        if area:
            area_counts[area] = area_counts.get(area, 0) + 1
    if area_counts:
        sorted_areas = sorted(area_counts.items(), key=lambda item: (-item[1], item[0]))
        primary_area = sorted_areas[0][0]
        if len(sorted_areas) > 1:
            return f"{primary_area} +{len(sorted_areas) - 1} area(s)"
        return primary_area
    target_name = str(record.get("targetName") or record.get("sourceTowerClicked") or "").strip()
    return re.sub(r"^(Tower|Transformer|Line Cut|Search Result):\s*", "", target_name, flags=re.IGNORECASE) or "-"


def _normalize_numeric(value):
    try:
        return float(str(value or "0").replace(",", ""))
    except (TypeError, ValueError):
        return 0.0


def _dashboard_filter_options(rows):
    return {
        "statuses": ["active", "scheduled", "restored"],
        "substations": sorted({row.get("substation") for row in rows if row.get("substation") and row.get("substation") != "-"}),
        "feeders": sorted({row.get("feeder") for row in rows if row.get("feeder") and row.get("feeder") != "-"}),
        "createdBy": sorted({row.get("createdBy") for row in rows if row.get("createdBy")}),
    }


def _dashboard_row_matches_filters(row, filters):
    if not filters:
        return True
    status = _normalize_filter_text(filters.get("status")).lower()
    substation = _normalize_filter_text(filters.get("substation")).lower()
    feeder = _normalize_filter_text(filters.get("feeder")).lower()
    created_by = _normalize_filter_text(filters.get("created_by")).lower()
    search = _normalize_filter_text(filters.get("search")).lower()
    date_from = _normalize_filter_date(filters.get("date_from"))
    date_to = _normalize_filter_date(filters.get("date_to"))
    row_date = _normalize_filter_date(row.get("startDate"))

    if status and status != "all" and row.get("status") != status:
        return False
    if substation and substation != "all" and _normalize_filter_text(row.get("substation")).lower() != substation:
        return False
    if feeder and feeder != "all" and _normalize_filter_text(row.get("feeder")).lower() != feeder:
        return False
    if created_by and created_by != "all" and _normalize_filter_text(row.get("createdBy")).lower() != created_by:
        return False
    if date_from and (not row_date or row_date < date_from):
        return False
    if date_to and (not row_date or row_date > date_to):
        return False
    if search:
        haystack = " ".join(str(row.get(key) or "") for key in (
            "name",
            "substation",
            "feeder",
            "feederName",
            "affectedArea",
            "remarks",
            "actionTaken",
        )).lower()
        if search not in haystack:
            return False
    return True


def _dashboard_counters(rows):
    counters = {"total": len(rows), "active": 0, "scheduled": 0, "restored": 0}
    for row in rows:
        status = row.get("status") if row.get("status") in counters else "active"
        counters[status] += 1
    return counters


def _dashboard_analytics(rows):
    total_customers = sum(int(_normalize_numeric(row.get("customersAffected"))) for row in rows)
    total_kwhr = sum(_normalize_numeric(row.get("estimatedKwhrLoss")) for row in rows)
    total_revenue = sum(_normalize_numeric(row.get("estimatedRevenueLoss")) for row in rows)
    durations = [int(_normalize_numeric(row.get("durationMinutes"))) for row in rows if _normalize_numeric(row.get("durationMinutes")) > 0]
    return {
        "totalCustomers": total_customers,
        "totalKwhrLoss": round(total_kwhr, 4),
        "totalRevenueLoss": round(total_revenue, 2),
        "averageRestoredDurationMinutes": int(round(sum(durations) / len(durations))) if durations else 0,
    }


def build_dashboard_model(filters=None):
    now = datetime.now()
    records = [serialize_interruption_row(row) for row in list_interruption_rows()]
    dashboard_rows = []

    for record in records:
        start_dt = _parse_local_datetime(record.get("startDate"), record.get("startTime"))
        status = normalize_monitoring_status(
            record.get("status"),
            start_date=record.get("startDate"),
            start_time=record.get("startTime"),
            restored_date=record.get("restoredDate"),
            restored_time=record.get("restoredTime"),
        )
        feeder_name = record.get("feederName") or ""
        action_taken = record.get("actionTaken", "")
        is_restored = status == "restored" or bool(action_taken)
        dashboard_restored_date = record.get("restoredDate") if is_restored else ""
        dashboard_restored_time = record.get("restoredTime") if is_restored else ""
        restored_dt = _parse_local_datetime(dashboard_restored_date, dashboard_restored_time)
        duration_minutes = _dashboard_duration_minutes(status, start_dt, restored_dt, now)
        loss_metrics = _duration_loss_metrics(start_dt, duration_minutes, record.get("matchedRows"))

        dashboard_rows.append({
            "id": record.get("id", ""),
            "name": record.get("name", ""),
            "status": status,
            "substation": infer_substation_name(feeder_name),
            "feeder": infer_feeder_code(feeder_name) or feeder_name or "-",
            "feederName": feeder_name,
            "affectedArea": infer_affected_area(record),
            "startDate": record.get("startDate") or "",
            "startTime": " ".join(part for part in [record.get("startDate"), record.get("startTime")] if part) or "-",
            "restoredDate": dashboard_restored_date if is_restored else "",
            "restoredTime": dashboard_restored_time if is_restored else "",
            "actionTaken": action_taken,
            "durationMinutes": duration_minutes,
            "customersAffected": record.get("totalAffectedAccounts", 0),
            "remarks": record.get("remarks") or record.get("traceConfidence", "confirmed").replace("_", " ").title(),
            "estimatedKwhrLoss": _format_number(loss_metrics["kwhr_loss"], places=4),
            "estimatedRevenueLoss": _format_number(loss_metrics["revenue_loss"], places=2),
            "affectedPoles": record.get("totalPolId", 0),
            "createdBy": record.get("createdBy", ""),
            "createdAt": record.get("createdAt", ""),
        })

    filtered_rows = [row for row in dashboard_rows if _dashboard_row_matches_filters(row, filters or {})]

    return {
        "counters": _dashboard_counters(filtered_rows),
        "rows": filtered_rows,
        "analytics": _dashboard_analytics(filtered_rows),
        "filters": filters or {},
        "filterOptions": _dashboard_filter_options(dashboard_rows),
        "updatedAt": now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def serialize_interruption_row(row):
    if not row:
        return None

    clicked_tower = _json_loads(row["clicked_tower_json"], None)
    affected_towers = _json_loads(row["affected_towers_json"], [])
    matched_rows = _json_loads(row["matched_rows_json"], [])
    line_indexes = _json_loads(row["line_indexes_json"], [])
    tower_indexes = _json_loads(row["tower_indexes_json"], [])
    kml_feature_ids = _json_loads(row["kml_feature_ids_json"], [])
    kml_feature = _json_loads(row["kml_feature_json"], None)
    audit = _json_loads(row["audit_json"], None)
    summary_counts = _interruption_summary_counts(row, affected_towers=affected_towers, matched_rows=matched_rows)
    monitoring = normalize_monitoring_fields(
        {
            "monitoring_status": row["monitoring_status"] if "monitoring_status" in row.keys() else "",
            "action_taken": row["action_taken"] if "action_taken" in row.keys() else "",
            "restored_date": row["restored_date"] if "restored_date" in row.keys() else "",
            "restored_time": row["restored_time"] if "restored_time" in row.keys() else "",
            "remarks": row["remarks"] if "remarks" in row.keys() else "",
            "start_date": row["start_date"] or "",
            "start_time": row["start_time"] or "",
        }
    )

    return {
        "id": str(row["id"]),
        "name": row["name"] or "",
        "startDate": row["start_date"] or "",
        "startTime": row["start_time"] or "",
        "endDate": row["end_date"] or "",
        "endTime": row["end_time"] or "",
        "contextType": row["context_type"] or "tower",
        "targetName": row["target_name"] or "",
        "sourceTowerClicked": row["source_tower_clicked"] or "",
        "clickedTower": clicked_tower if isinstance(clicked_tower, dict) else None,
        "clickedLineIndex": row["clicked_line_index"] if row["clicked_line_index"] is not None else None,
        "affectedTowers": affected_towers if isinstance(affected_towers, list) else [],
        "matchedRows": matched_rows if isinstance(matched_rows, list) else [],
        "lineIndexes": line_indexes if isinstance(line_indexes, list) else [],
        "towerIndexes": tower_indexes if isinstance(tower_indexes, list) else [],
        "kmlFeatureIds": kml_feature_ids if isinstance(kml_feature_ids, list) else [],
        "kmlFeature": kml_feature if isinstance(kml_feature, dict) else None,
        "audit": audit if isinstance(audit, dict) else None,
        "traceConfidence": row["trace_confidence"] or ((audit or {}).get("trace_confidence", "confirmed") if isinstance(audit, dict) else "confirmed"),
        "status": monitoring["status"],
        "actionTaken": monitoring["actionTaken"],
        "restoredDate": monitoring["restoredDate"],
        "restoredTime": monitoring["restoredTime"],
        "remarks": monitoring["remarks"],
        "feederName": row["feeder_name"] or "",
        "totalPolId": summary_counts["totalPolId"],
        "totalAffectedAccounts": summary_counts["totalAffectedAccounts"],
        "matchedRowsCount": summary_counts["matchedRowsCount"],
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"] or "",
    }


def serialize_interruption_summary_row(row):
    if not row:
        return None
    summary_counts = _interruption_summary_counts(row)
    monitoring = normalize_monitoring_fields(
        {
            "monitoring_status": row["monitoring_status"] if "monitoring_status" in row.keys() else "",
            "action_taken": row["action_taken"] if "action_taken" in row.keys() else "",
            "restored_date": row["restored_date"] if "restored_date" in row.keys() else "",
            "restored_time": row["restored_time"] if "restored_time" in row.keys() else "",
            "remarks": row["remarks"] if "remarks" in row.keys() else "",
            "start_date": row["start_date"] or "",
            "start_time": row["start_time"] or "",
        }
    )
    return {
        "id": str(row["id"]),
        "name": row["name"] or "",
        "startDate": row["start_date"] or "",
        "startTime": row["start_time"] or "",
        "endDate": row["end_date"] or "",
        "endTime": row["end_time"] or "",
        "contextType": row["context_type"] or "tower",
        "targetName": row["target_name"] or "",
        "sourceTowerClicked": row["source_tower_clicked"] or "",
        "clickedTower": None,
        "clickedLineIndex": None,
        "affectedTowers": [],
        "matchedRows": [],
        "lineIndexes": [],
        "towerIndexes": [],
        "kmlFeatureIds": [],
        "kmlFeature": None,
        "audit": None,
        "traceConfidence": row["trace_confidence"] or "confirmed",
        "status": monitoring["status"],
        "actionTaken": monitoring["actionTaken"],
        "restoredDate": monitoring["restoredDate"],
        "restoredTime": monitoring["restoredTime"],
        "remarks": monitoring["remarks"],
        "feederName": row["feeder_name"] or "",
        "totalPolId": summary_counts["totalPolId"],
        "totalAffectedAccounts": summary_counts["totalAffectedAccounts"],
        "matchedRowsCount": summary_counts["matchedRowsCount"],
        "createdBy": row["created_by"] or "",
        "createdAt": row["created_at"] or "",
    }


def prune_audit_logs(force=False, raise_on_error=False):
    global LAST_AUDIT_PRUNE_TS
    now = time.monotonic()
    prune_interval = int(app.config.get("AUDIT_LOG_PRUNE_INTERVAL_SECONDS", 120) or 120)
    if not force and (now - LAST_AUDIT_PRUNE_TS) < prune_interval:
        return {"deleted_rows": 0, "performed": False}

    retention_days = int(app.config.get("AUDIT_LOG_RETENTION_DAYS", 90) or 90)
    max_rows = int(app.config.get("AUDIT_LOG_MAX_ROWS", 10000) or 10000)
    prune_batch_rows = max(100, int(app.config.get("AUDIT_LOG_PRUNE_BATCH_ROWS", 1000) or 1000))
    try:
        deleted_rows = 0
        with managed_db(app.config["AUTH_DB_PATH"], busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"]) as connection:
            if retention_days > 0:
                while True:
                    cursor = connection.execute(
                        """
                        DELETE FROM audit_logs
                        WHERE id IN (
                            SELECT id
                            FROM audit_logs
                            WHERE timestamp < datetime('now', ?)
                            ORDER BY timestamp ASC, id ASC
                            LIMIT ?
                        )
                        """,
                        (f"-{retention_days} days", prune_batch_rows),
                    )
                    batch_deleted = max(0, int(cursor.rowcount or 0))
                    deleted_rows += batch_deleted
                    if batch_deleted < prune_batch_rows:
                        break
            if max_rows > 0:
                count_row = connection.execute("SELECT COUNT(*) AS total FROM audit_logs").fetchone()
                overflow_rows = max(0, int((count_row["total"] if count_row else 0) or 0) - max_rows)
                while overflow_rows > 0:
                    batch_size = min(prune_batch_rows, overflow_rows)
                    cursor = connection.execute(
                        """
                        DELETE FROM audit_logs
                        WHERE id IN (
                            SELECT id
                            FROM audit_logs
                            ORDER BY timestamp ASC, id ASC
                            LIMIT ?
                        )
                        """,
                        (batch_size,),
                    )
                    batch_deleted = max(0, int(cursor.rowcount or 0))
                    deleted_rows += batch_deleted
                    overflow_rows -= batch_deleted
                    if batch_deleted <= 0:
                        break
        LAST_AUDIT_PRUNE_TS = now
        if deleted_rows > 0:
            maybe_maintain_wal(force=True)
        return {"deleted_rows": deleted_rows, "performed": True}
    except Exception as exc:
        if raise_on_error:
            raise
        return {"deleted_rows": 0, "performed": False}


def delete_all_audit_logs():
    with managed_db(app.config["AUTH_DB_PATH"], busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"]) as connection:
        count_row = connection.execute("SELECT COUNT(*) AS total FROM audit_logs").fetchone()
        total_rows = int((count_row["total"] if count_row else 0) or 0)
        if total_rows > 0:
            connection.execute("DELETE FROM audit_logs")
    maintenance_warning = ""
    checkpoint_result = None
    vacuum_result = None
    try:
        checkpoint_result = checkpoint_wal(
            app.config["AUTH_DB_PATH"],
            busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"],
            mode="TRUNCATE",
        )
        vacuum_result = vacuum_database(
            app.config["AUTH_DB_PATH"],
            busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"],
        )
    except DatabaseBusyError as exc:
        maintenance_warning = str(exc)
    return {
        "deleted_rows": total_rows,
        "checkpoint": checkpoint_result,
        "vacuum": vacuum_result,
        "maintenance_warning": maintenance_warning,
    }

def maybe_maintain_wal(force=False):
    global LAST_WAL_MAINTENANCE_TS
    now = time.monotonic()
    maintenance_interval = int(app.config.get("SQLITE_WAL_MAINTENANCE_INTERVAL_SECONDS", 180) or 180)
    if not force and (now - LAST_WAL_MAINTENANCE_TS) < maintenance_interval:
        return {"performed": False, "reason": "interval"}
    try:
        result = maintain_wal(
            app.config["AUTH_DB_PATH"],
            busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"],
            checkpoint_threshold_bytes=app.config.get("SQLITE_WAL_CHECKPOINT_BYTES", 32 * 1024 * 1024),
            force=force,
        )
        LAST_WAL_MAINTENANCE_TS = now
        return result
    except Exception:
        return {"performed": False, "reason": "error"}


AUDIT_DETAIL_ALLOWED_KEYS = {
    "login_success": {"request_path", "method", "ip"},
    "login_failure": {"request_path", "method", "ip", "reason"},
    "logout": {"request_path", "method", "ip"},
    "feeder_upload_attempt": {"request_path", "method", "ip", "filename", "size_bytes"},
    "feeder_upload_success": {"request_path", "method", "ip", "filename", "size_bytes", "total_towers", "total_lines", "validation_status"},
    "feeder_upload_failure": {"request_path", "method", "ip", "filename", "size_bytes", "message"},
    "xlsx_upload_attempt": {"request_path", "method", "ip", "filename", "size_bytes"},
    "xlsx_upload_success": {"request_path", "method", "ip", "filename", "size_bytes", "row_count", "validation_status", "parse_ms", "cache_save_ms", "workbook_open_ms", "header_detection_ms", "row_processing_ms"},
    "xlsx_upload_failure": {"request_path", "method", "ip", "filename", "size_bytes", "message"},
    "kml_upload_attempt": {"request_path", "method", "ip", "filename", "size_bytes"},
    "kml_upload_success": {"request_path", "method", "ip", "filename", "size_bytes", "feature_count", "validation_status"},
    "kml_upload_failure": {"request_path", "method", "ip", "filename", "size_bytes", "message"},
    "export_interruption": {"request_path", "method", "ip", "name", "target_name", "feeder_name", "trace_confidence"},
    "export_disconnected_fragments": {"request_path", "method", "ip", "fragment_count", "feeder_name"},
    "save_interruption": {"request_path", "method", "ip", "interruption_id", "name", "target_name", "context_type", "feeder_name"},
    "delete_interruption": {"request_path", "method", "ip", "interruption_id", "name"},
    "update_interruption_monitoring": {"request_path", "method", "ip", "interruption_id", "name", "status", "action_taken"},
    "clear_workspace": {"request_path", "method", "ip", "source"},
    "create_user": {"request_path", "method", "ip", "target_username", "role", "target_role"},
    "update_role": {"request_path", "method", "ip", "target_username", "previous_role", "new_role", "role"},
    "reset_password": {"request_path", "method", "ip", "target_username"},
    "delete_user": {"request_path", "method", "ip", "target_username", "target_role"},
}


def _sanitize_audit_value(value, depth=0):
    if depth > 2:
        return "[truncated]"
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        text = value.strip()
        return text if len(text) <= 220 else f"{text[:217]}..."
    if isinstance(value, dict):
        sanitized = {}
        for key, nested_value in list(value.items())[:20]:
            sanitized[str(key)] = _sanitize_audit_value(nested_value, depth + 1)
        if len(value) > 20:
            sanitized["_extra_keys"] = len(value) - 20
        return sanitized
    if isinstance(value, (list, tuple, set)):
        values = list(value)
        return {
            "count": len(values),
            "sample": [_sanitize_audit_value(item, depth + 1) for item in values[:5]],
        }
    return _sanitize_audit_value(str(value), depth + 1)


def _compact_audit_payload(action_type, payload):
    allowed_keys = AUDIT_DETAIL_ALLOWED_KEYS.get(action_type, {"request_path", "method", "ip"})
    compact_payload = {}
    for key in allowed_keys:
        if key in payload:
            compact_payload[key] = _sanitize_audit_value(payload[key])
    extra_keys = sorted(set(payload.keys()) - set(compact_payload.keys()))
    if extra_keys:
        compact_payload["_ignored_keys"] = extra_keys[:12]
        if len(extra_keys) > 12:
            compact_payload["_ignored_key_count"] = len(extra_keys)
    return compact_payload


def log_audit_event(action_type, details=None, username=None, role=None):
    resolved_user = username
    resolved_role = role
    if not resolved_user and getattr(g, "current_user", None):
        resolved_user = g.current_user["username"]
    if not resolved_role and getattr(g, "current_user", None):
        resolved_role = g.current_user["role"]

    resolved_user = str(resolved_user or "anonymous").strip() or "anonymous"
    resolved_role = str(resolved_role or "unknown").strip() or "unknown"
    payload = {
        "request_path": request.path if request else "",
        "method": request.method if request else "",
        "ip": request.headers.get("X-Forwarded-For", request.remote_addr or "") if request else "",
    }
    if isinstance(details, dict):
        payload.update(details)
    compact_payload = _compact_audit_payload(str(action_type or "").strip(), payload)

    try:
        with managed_db(app.config["AUTH_DB_PATH"], busy_timeout_ms=app.config["SQLITE_BUSY_TIMEOUT_MS"]) as connection:
            connection.execute(
                """
                INSERT INTO audit_logs (username, role, action_type, details_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    resolved_user,
                    resolved_role,
                    str(action_type or "").strip(),
                    _json_dumps(compact_payload, {}, compact=True),
                ),
            )
        prune_audit_logs(force=False)
        maybe_maintain_wal(force=False)
    except Exception:
        print(f"[audit-warning] action={action_type} message=best-effort audit write failed")


def list_audit_log_rows(date_from="", date_to="", username="", action_type=""):
    where_clauses = []
    params = []

    if date_from:
        where_clauses.append("timestamp >= datetime(?)")
        params.append(f"{date_from.strip()} 00:00:00")
    if date_to:
        where_clauses.append("timestamp < datetime(?, '+1 day')")
        params.append(date_to.strip())
    if username:
        where_clauses.append("lower(username) LIKE ?")
        params.append(f"%{username.strip().lower()}%")
    if action_type:
        where_clauses.append("action_type = ?")
        params.append(action_type.strip())

    query = """
        SELECT id, timestamp, username, role, action_type, details_json
        FROM audit_logs
    """
    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)
    query += " ORDER BY datetime(timestamp) DESC, id DESC LIMIT 500"

    with get_app_db_read_connection() as connection:
        rows = connection.execute(query, params).fetchall()
    return rows


def serialize_audit_log_row(row):
    return {
        "id": row["id"],
        "timestamp": row["timestamp"] or "",
        "username": row["username"] or "",
        "role": row["role"] or "",
        "action_type": row["action_type"] or "",
        "details": _json_loads(row["details_json"], {}),
    }


def get_system_status_snapshot():
    backup_records = list_backup_files(app.config["BACKUP_DIR"], limit=8)
    wal_path = f"{app.config['AUTH_DB_PATH']}-wal"
    return {
        "database_path": app.config["AUTH_DB_PATH"],
        "environment_mode": app.config["OUTAGE_ENV"],
        "debug_enabled": bool(app.config.get("DEBUG", False)),
        "secure_cookie_enabled": bool(app.config.get("SESSION_COOKIE_SECURE", False)),
        "use_proxy_fix": bool(app.config.get("USE_PROXY_FIX", False)),
        "preferred_url_scheme": app.config.get("PREFERRED_URL_SCHEME", "https"),
        "backup_dir": app.config["BACKUP_DIR"],
        "workspace_cache_dir": app.config["WORKSPACE_CACHE_DIR"],
        "busy_timeout_ms": app.config["SQLITE_BUSY_TIMEOUT_MS"],
        "wal_size_bytes": get_file_size(wal_path),
        "wal_checkpoint_bytes": app.config.get("SQLITE_WAL_CHECKPOINT_BYTES", 32 * 1024 * 1024),
        "audit_log_retention_days": app.config["AUDIT_LOG_RETENTION_DAYS"],
        "audit_log_max_rows": app.config["AUDIT_LOG_MAX_ROWS"],
        "source_identifiers": list(app.config.get("SOURCE_IDENTIFIERS", [])),
        "source_coordinates": app.config.get("SOURCE_COORDINATES"),
        "backup_files": backup_records,
        "last_backup_at": backup_records[0]["modified_at"] if backup_records else None,
    }


def _empty_workspace_payload():
    return {
        "feederFileName": "",
        "network": None,
        "accountData": None,
        "kmlOverlay": None,
        "validationReports": {
            "feeder": None,
            "xlsx": None,
            "kml": None,
        },
        "updatedAt": None,
    }


def _workspace_stub_payload(feeder_file_name="", updated_at=None):
    payload = _empty_workspace_payload()
    payload["feederFileName"] = feeder_file_name or ""
    payload["updatedAt"] = updated_at or None
    return payload


def _compact_account_data(account_data):
    if not isinstance(account_data, dict):
        return account_data
    compact_records = []
    for record in account_data.get("records", []):
        if not isinstance(record, dict):
            continue
        compact_records.append({
            "frombus_id": record.get("frombus_id", ""),
            "tobus_id": record.get("tobus_id", ""),
            "pol_id": record.get("pol_id", ""),
            "account_number": record.get("account_number", ""),
            "consumer_name": record.get("consumer_name", ""),
            "consumer_type": record.get("consumer_type", ""),
            "address": record.get("address", ""),
            "serial": record.get("serial", ""),
            "brand": record.get("brand", ""),
            "kwhr": record.get("kwhr", 0),
            "frombus_norm": record.get("frombus_norm", ""),
            "tobus_norm": record.get("tobus_norm", ""),
            "pol_norm": record.get("pol_norm", ""),
            "extra_fields": record.get("extra_fields", record.get("all_fields", {})) or {},
        })
    return {
        "headers": account_data.get("headers", []),
        "row_count": account_data.get("row_count", len(compact_records)),
        "records": compact_records,
        "validation": account_data.get("validation", {}),
        "timings": account_data.get("timings", {}),
    }


def _compact_network_data(network):
    if not isinstance(network, dict):
        return network
    return {
        **network,
        "towers": list(network.get("towers", [])),
        "lines": list(network.get("lines", [])),
        "disconnected_fragments": list(network.get("disconnected_fragments", [])),
        "validation": network.get("validation", {}),
    }


def _compact_kml_overlay(overlay):
    if not isinstance(overlay, dict):
        return overlay
    return {
        **overlay,
        "features": list(overlay.get("features", [])),
        "validation": overlay.get("validation", {}),
    }


def _validation_summary(report):
    base_report = make_validation()
    if isinstance(report, dict):
        merged_report = dict(base_report)
        for key in ("errors", "warnings", "info"):
            merged_report[key] = list(report.get(key, base_report[key]) or [])
        summary_value = report.get("summary", base_report["summary"])
        merged_report["summary"] = dict(summary_value or {})
        report = merged_report
    normalized = finalize_validation(report or base_report)
    return {
        "status": normalized.get("status", "ok"),
        "errors": list(normalized.get("errors", [])[:10]),
        "warnings": list(normalized.get("warnings", [])[:20]),
        "info": list(normalized.get("info", [])[:20]),
        "summary": dict(normalized.get("summary", {})),
    }


def _workspace_cache_dir(user_id):
    return os.path.join(app.config["WORKSPACE_CACHE_DIR"], str(user_id))


def _workspace_cache_path(user_id, cache_name):
    return os.path.join(_workspace_cache_dir(user_id), f"{cache_name}.json")


def _workspace_cache_size(user_id, cache_name):
    cache_path = _workspace_cache_path(user_id, cache_name)
    try:
        return os.path.getsize(cache_path)
    except OSError:
        return 0


def _write_workspace_cache_payload(user_id, cache_name, payload):
    cache_dir = _workspace_cache_dir(user_id)
    os.makedirs(cache_dir, exist_ok=True)
    cache_path = _workspace_cache_path(user_id, cache_name)
    temp_path = f"{cache_path}.tmp"
    with open(temp_path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(temp_path, cache_path)
    return {
        "cacheName": cache_name,
        "cachePath": cache_path,
        "sizeBytes": os.path.getsize(cache_path),
    }


def _read_workspace_cache_payload(user_id, cache_name, *, max_bytes=None):
    cache_path = _workspace_cache_path(user_id, cache_name)
    if not os.path.exists(cache_path):
        return None
    if max_bytes is not None:
        try:
            if os.path.getsize(cache_path) > int(max_bytes):
                return None
        except OSError:
            return None
    try:
        with open(cache_path, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def _remove_workspace_cache_payload(user_id, cache_name):
    if not user_id or not cache_name:
        return
    cache_path = _workspace_cache_path(user_id, cache_name)
    try:
        if os.path.exists(cache_path):
            os.remove(cache_path)
    except OSError:
        pass


def _clear_workspace_cache(user_id):
    if not user_id:
        return
    cache_dir = _workspace_cache_dir(user_id)
    if os.path.isdir(cache_dir):
        shutil.rmtree(cache_dir, ignore_errors=True)
    _clear_user_cache_entries(ACCOUNT_QUERY_CACHE, user_id)
    _clear_user_cache_entries(KML_FEATURE_CACHE, user_id)


def _network_workspace_meta(network, cache_info=None):
    return {
        "cacheName": cache_info.get("cacheName") if cache_info else "network",
        "sizeBytes": int(cache_info.get("sizeBytes", 0)) if cache_info else 0,
        "towerCount": len((network or {}).get("towers", []) if isinstance(network, dict) else []),
        "lineCount": len((network or {}).get("lines", []) if isinstance(network, dict) else []),
        "isInferred": bool((network or {}).get("is_inferred")) if isinstance(network, dict) else False,
    }


def _account_workspace_meta(account_data, cache_info=None):
    return {
        "cacheName": cache_info.get("cacheName") if cache_info else "account_data",
        "sizeBytes": int(cache_info.get("sizeBytes", 0)) if cache_info else 0,
        "rowCount": int((account_data or {}).get("row_count", 0) or 0),
        "headers": list((account_data or {}).get("headers", [])),
        "timings": dict((account_data or {}).get("timings", {})),
    }


def _kml_workspace_meta(overlay, cache_info=None):
    return {
        "cacheName": cache_info.get("cacheName") if cache_info else "kml_overlay",
        "sizeBytes": int(cache_info.get("sizeBytes", 0)) if cache_info else 0,
        "featureCount": len((overlay or {}).get("features", []) if isinstance(overlay, dict) else []),
    }


def _workspace_metadata_defaults():
    return {
        "totalBytes": 0,
        "requiresManualRestore": False,
        "isLarge": False,
        "updatedAt": None,
        "feederFileName": "",
        "network": None,
        "accountData": None,
        "kmlOverlay": None,
        "recoveryWarnings": [],
    }


def _workspace_component_recovery_warnings(user_id, network_meta=None, account_meta=None, kml_meta=None):
    warnings = []
    components = [
        ("Feeder", network_meta, "network"),
        ("XLSX", account_meta, "account_data"),
        ("KML", kml_meta, "kml_overlay"),
    ]
    for label, meta, fallback_name in components:
        if not meta:
            continue
        cache_name = meta.get("cacheName", fallback_name)
        cache_path = _workspace_cache_path(user_id, cache_name)
        if not os.path.exists(cache_path):
            warnings.append(f"{label} workspace cache file is missing.")
            continue
        try:
            if os.path.getsize(cache_path) <= 0:
                warnings.append(f"{label} workspace cache file is empty.")
        except OSError:
            warnings.append(f"{label} workspace cache file could not be read.")
    return warnings


def _repair_user_workspace_metadata(user_id, *, clear_network=False, clear_account=False, clear_kml=False):
    if not user_id or not any([clear_network, clear_account, clear_kml]):
        return False

    _clear_user_cache_entries(ACCOUNT_QUERY_CACHE, user_id)
    _clear_user_cache_entries(KML_FEATURE_CACHE, user_id)
    with get_app_db_connection() as connection:
        updates = []
        params = []
        if clear_network:
            updates.extend([
                "network_json = NULL",
                "feeder_validation_json = NULL",
                "feeder_file_name = CASE WHEN account_data_json IS NULL AND kml_overlay_json IS NULL THEN '' ELSE feeder_file_name END",
            ])
        if clear_account:
            updates.extend([
                "account_data_json = NULL",
                "xlsx_validation_json = NULL",
            ])
        if clear_kml:
            updates.extend([
                "kml_overlay_json = NULL",
                "kml_validation_json = NULL",
            ])
        updates.append("updated_at = CURRENT_TIMESTAMP")
        params.append(user_id)
        connection.execute(
            f"UPDATE user_workspace SET {', '.join(updates)} WHERE user_id = ?",
            tuple(params),
        )
        connection.commit()
    return True


def _repair_workspace_metadata_if_needed(row):
    if not row:
        return row

    user_id = row["user_id"]
    network_meta = _json_loads(row["network_json"], None)
    account_meta = _json_loads(row["account_data_json"], None)
    kml_meta = _json_loads(row["kml_overlay_json"], None)
    clear_network = bool(network_meta and "Feeder workspace cache file is" in " ".join(
        _workspace_component_recovery_warnings(user_id, network_meta=network_meta)
    ))
    clear_account = bool(account_meta and "XLSX workspace cache file is" in " ".join(
        _workspace_component_recovery_warnings(user_id, account_meta=account_meta)
    ))
    clear_kml = bool(kml_meta and "KML workspace cache file is" in " ".join(
        _workspace_component_recovery_warnings(user_id, kml_meta=kml_meta)
    ))

    if not any([clear_network, clear_account, clear_kml]):
        return row

    _repair_user_workspace_metadata(
        user_id,
        clear_network=clear_network,
        clear_account=clear_account,
        clear_kml=clear_kml,
    )
    with get_app_db_connection() as connection:
        return connection.execute(
            """
            SELECT
                user_id,
                feeder_file_name,
                network_json,
                feeder_validation_json,
                account_data_json,
                xlsx_validation_json,
                kml_overlay_json,
                kml_validation_json,
                updated_at
            FROM user_workspace
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()


def _normalize_lookup_id(value):
    if value is None:
        return ""
    text = str(value).strip().upper()
    if not text:
        return ""
    text = text.split()[0]
    if "-" in text:
        first = text.split("-", 1)[0]
        if first.startswith(("TAL", "ALG", "MNZ")):
            text = first
    text = re.sub(r"-\d+$", "", text)
    return text.strip()


def _load_cached_account_payload(user_id):
    metadata = get_user_workspace_metadata(user_id)
    account_meta = metadata.get("accountData") or {}
    cache_name = account_meta.get("cacheName")
    if not cache_name:
        return None
    return _read_workspace_cache_payload(user_id, cache_name)


def _load_cached_kml_payload(user_id):
    metadata = get_user_workspace_metadata(user_id)
    kml_meta = metadata.get("kmlOverlay") or {}
    cache_name = kml_meta.get("cacheName")
    if not cache_name:
        return None
    return _read_workspace_cache_payload(user_id, cache_name)


def _touch_lru_cache(cache_map, cache_key, cache_value=None):
    existing = cache_map.pop(cache_key, None)
    value = cache_value if cache_value is not None else existing
    if value is None:
        return None
    cache_map[cache_key] = value
    return value


def _trim_lru_cache(cache_map, limit):
    while len(cache_map) > limit:
        oldest_key = next(iter(cache_map.keys()), None)
        if oldest_key is None:
            break
        cache_map.pop(oldest_key, None)


def _clear_user_cache_entries(cache_map, user_id):
    for cache_key in list(cache_map.keys()):
        if cache_key and cache_key[0] == user_id:
            cache_map.pop(cache_key, None)


def _normalize_account_record(record):
    if not isinstance(record, dict):
        return None
    mapping_entry = record
    mapping_entry["frombus_id"] = str(mapping_entry.get("frombus_id", "") or "")
    mapping_entry["tobus_id"] = str(mapping_entry.get("tobus_id", "") or "")
    mapping_entry["pol_id"] = str(mapping_entry.get("pol_id", "") or "")
    mapping_entry["account_number"] = str(mapping_entry.get("account_number", "") or "")
    mapping_entry["consumer_name"] = str(mapping_entry.get("consumer_name", "") or "")
    mapping_entry["consumer_type"] = str(mapping_entry.get("consumer_type", "") or "")
    mapping_entry["address"] = str(mapping_entry.get("address", "") or "")
    mapping_entry["serial"] = str(mapping_entry.get("serial", "") or "")
    mapping_entry["brand"] = str(mapping_entry.get("brand", "") or "")
    mapping_entry["kwhr"] = mapping_entry.get("kwhr", 0) or 0
    mapping_entry["frombus_norm"] = mapping_entry.get("frombus_norm") or _normalize_lookup_id(mapping_entry["frombus_id"])
    mapping_entry["tobus_norm"] = mapping_entry.get("tobus_norm") or _normalize_lookup_id(mapping_entry["tobus_id"])
    mapping_entry["pol_norm"] = mapping_entry.get("pol_norm") or _normalize_lookup_id(mapping_entry["pol_id"])
    mapping_entry["extra_fields"] = mapping_entry.get("extra_fields", {}) or {}
    return mapping_entry


def _build_account_query_cache_entry(account_payload):
    if not isinstance(account_payload, dict):
        return None

    records = list(account_payload.get("records", []) or [])
    tower_lookup = {}
    exact_account_lookup = {}
    normalized_lookup = {}
    feature_token_lookup = {}
    search_rows = []
    row_signatures = []

    for record_index, record in enumerate(records):
        mapping_entry = _normalize_account_record(record)
        if not mapping_entry:
            row_signatures.append("")
            continue
        records[record_index] = mapping_entry
        row_signatures.append(
            f"{mapping_entry.get('pol_id','')}|||{mapping_entry.get('account_number','')}|||"
            f"{mapping_entry.get('frombus_id','')}|||{mapping_entry.get('tobus_id','')}"
        )

        for lookup_value in {mapping_entry["pol_norm"], mapping_entry["frombus_norm"], mapping_entry["tobus_norm"]}:
            if not lookup_value:
                continue
            tower_lookup.setdefault(lookup_value, []).append(record_index)
            normalized_lookup.setdefault(lookup_value, []).append(record_index)

        exact_account = str(mapping_entry.get("account_number", "")).strip().upper()
        if exact_account:
            exact_account_lookup.setdefault(exact_account, []).append(record_index)

        feature_tokens = set()
        for raw_value in [
            mapping_entry.get("pol_id", ""),
            mapping_entry.get("account_number", ""),
            mapping_entry.get("frombus_id", ""),
            mapping_entry.get("tobus_id", ""),
            *list((mapping_entry.get("extra_fields") or {}).values()),
        ]:
            raw = str(raw_value or "").strip().upper()
            if not raw:
                continue
            feature_tokens.add(raw)
            normalized = _normalize_lookup_id(raw)
            if normalized:
                feature_tokens.add(normalized)
                normalized_lookup.setdefault(normalized, []).append(record_index)

        for token in feature_tokens:
            feature_token_lookup.setdefault(token, []).append(record_index)

        search_rows.append((
            record_index,
            exact_account,
            mapping_entry["pol_norm"],
            mapping_entry["frombus_norm"],
            mapping_entry["tobus_norm"],
        ))

    normalized_lookup = {
        key: list(dict.fromkeys(indexes))
        for key, indexes in normalized_lookup.items()
    }
    feature_token_lookup = {
        key: list(dict.fromkeys(indexes))
        for key, indexes in feature_token_lookup.items()
    }

    account_payload["records"] = records
    return {
        "payload": account_payload,
        "records": records,
        "tower_lookup": tower_lookup,
        "exact_account_lookup": exact_account_lookup,
        "normalized_lookup": normalized_lookup,
        "feature_token_lookup": feature_token_lookup,
        "search_rows": search_rows,
        "row_signatures": row_signatures,
    }


def _cache_account_query_entry(cache_key, account_payload):
    cache_entry = _build_account_query_cache_entry(account_payload)
    if not cache_entry:
        return None
    _touch_lru_cache(ACCOUNT_QUERY_CACHE, cache_key, cache_entry)
    _trim_lru_cache(ACCOUNT_QUERY_CACHE, ACCOUNT_QUERY_CACHE_LIMIT)
    return cache_entry


def _get_kml_feature_index(user_id):
    metadata = get_user_workspace_metadata(user_id)
    kml_meta = metadata.get("kmlOverlay") or {}
    cache_name = kml_meta.get("cacheName", "kml_overlay")
    cache_path = _workspace_cache_path(user_id, cache_name)
    try:
        cache_mtime = os.path.getmtime(cache_path)
    except OSError:
        cache_mtime = None

    cache_key = (user_id, cache_name, cache_mtime)
    cached = _touch_lru_cache(KML_FEATURE_CACHE, cache_key)
    if cached:
        return cached

    kml_payload = _load_cached_kml_payload(user_id) or {}
    feature_index = {}
    for feature in kml_payload.get("features", []):
        if not isinstance(feature, dict):
            continue
        feature_id = feature.get("id")
        if not feature_id:
            continue
        text = f"{feature.get('name','')} {feature.get('description','')}".upper()
        feature_index[feature_id] = {
            "name": feature.get("name", "") or "",
            "account_numbers": ACCOUNT_NUMBER_PATTERN.findall(text),
        }

    _touch_lru_cache(KML_FEATURE_CACHE, cache_key, feature_index)
    _trim_lru_cache(KML_FEATURE_CACHE, KML_FEATURE_CACHE_LIMIT)
    return feature_index


def _get_account_query_indexes(user_id, account_payload=None):
    metadata = get_user_workspace_metadata(user_id)
    account_meta = metadata.get("accountData") or {}
    cache_name = account_meta.get("cacheName", "account_data")
    cache_path = _workspace_cache_path(user_id, cache_name)
    try:
        cache_mtime = os.path.getmtime(cache_path)
    except OSError:
        cache_mtime = None
    cache_key = (user_id, cache_name, cache_mtime)
    cached = _touch_lru_cache(ACCOUNT_QUERY_CACHE, cache_key)
    if cached:
        return cached.get("payload"), cached

    account_payload = account_payload or _load_cached_account_payload(user_id)
    if not account_payload:
        return None, None

    cache_entry = _cache_account_query_entry(cache_key, account_payload)
    if not cache_entry:
        return None, None
    return cache_entry.get("payload"), cache_entry


def _build_matched_row(mapping_entry, matched_tower="", matched_via="Tower"):
    return {
        "matched_tower": matched_tower or "",
        "frombus_id": mapping_entry.get("frombus_id", ""),
        "tobus_id": mapping_entry.get("tobus_id", ""),
        "pol_id": mapping_entry.get("pol_id", ""),
        "account_number": mapping_entry.get("account_number", ""),
        "consumer_name": mapping_entry.get("consumer_name", ""),
        "consumer_type": mapping_entry.get("consumer_type", ""),
        "address": mapping_entry.get("address", ""),
        "serial": mapping_entry.get("serial", ""),
        "brand": mapping_entry.get("brand", ""),
        "kwhr": mapping_entry.get("kwhr", 0),
        "matched_via": matched_via,
        "extra_fields": mapping_entry.get("extra_fields", {}) or {},
    }


def _query_account_rows_for_towers(user_id, tower_names=None, kml_feature_ids=None):
    account_payload, indexes = _get_account_query_indexes(user_id)
    if not account_payload or not indexes:
        return []

    records = indexes.get("records", [])
    tower_lookup = indexes.get("tower_lookup", {})
    row_signatures = indexes.get("row_signatures", [])
    seen = set()
    results = []
    for tower_name in tower_names or []:
        normalized_tower = _normalize_lookup_id(tower_name)
        for record_index in tower_lookup.get(normalized_tower, []):
            row = records[record_index] if record_index < len(records) else None
            if not row:
                continue
            key = f"{normalized_tower}|||{row_signatures[record_index] if record_index < len(row_signatures) else ''}"
            if key in seen:
                continue
            seen.add(key)
            results.append(_build_matched_row(
                row,
                matched_tower=tower_name,
                matched_via="Pol ID" if _normalize_lookup_id(row.get("pol_id", "")) == normalized_tower else "Tower",
            ))

    if kml_feature_ids:
        feature_index = _get_kml_feature_index(user_id)
        exact_account_lookup = indexes.get("exact_account_lookup", {})
        for feature_id in kml_feature_ids:
            feature = feature_index.get(feature_id)
            if not feature:
                continue
            for account_number in feature.get("account_numbers", []):
                for record_index in exact_account_lookup.get(account_number, []):
                    row = records[record_index] if record_index < len(records) else None
                    if not row:
                        continue
                    if str(row.get("account_number", "")).strip().upper() != account_number:
                        continue
                    key = f"KML|||{row_signatures[record_index] if record_index < len(row_signatures) else ''}"
                    if key in seen:
                        continue
                    seen.add(key)
                    results.append(_build_matched_row(row, matched_tower=feature.get("name", account_number), matched_via="KML"))
    return results


def _search_account_rows(user_id, query):
    account_payload, indexes = _get_account_query_indexes(user_id)
    if not account_payload or not indexes:
        return []
    normalized_query = _normalize_lookup_id(query)
    exact_account = str(query or "").strip().upper()
    seen = set()
    results = []
    records = indexes.get("records", [])
    row_signatures = indexes.get("row_signatures", [])
    exact_account_lookup = indexes.get("exact_account_lookup", {})
    normalized_lookup = indexes.get("normalized_lookup", {})
    search_rows = indexes.get("search_rows", [])

    if exact_account:
        for record_index in exact_account_lookup.get(exact_account, []):
            record = records[record_index] if record_index < len(records) else None
            if not record:
                continue
            key = row_signatures[record_index] if record_index < len(row_signatures) else ""
            if key in seen:
                continue
            seen.add(key)
            results.append(_build_matched_row(record, matched_tower="", matched_via="Account Number"))
            if len(results) >= ACCOUNT_QUERY_RESULT_LIMIT:
                return results

    if normalized_query and normalized_query != exact_account:
        for record_index in normalized_lookup.get(normalized_query, []):
            record = records[record_index] if record_index < len(records) else None
            if not record:
                continue
            key = row_signatures[record_index] if record_index < len(row_signatures) else ""
            if key in seen:
                continue
            seen.add(key)
            results.append(_build_matched_row(record, matched_tower="", matched_via="Pol ID"))
            if len(results) >= ACCOUNT_QUERY_RESULT_LIMIT:
                return results

    for record_index, account_number, pol_norm, from_norm, to_norm in search_rows:
        record = records[record_index] if record_index < len(records) else None
        if not record:
            continue
        if (exact_account and exact_account in account_number) or any(normalized_query and normalized_query in value for value in [pol_norm, from_norm, to_norm]):
            key = row_signatures[record_index] if record_index < len(row_signatures) else ""
            if key in seen:
                continue
            seen.add(key)
            results.append(_build_matched_row(record, matched_tower="", matched_via="Account Number" if exact_account and exact_account in account_number else "Pol ID"))
            if len(results) >= ACCOUNT_QUERY_RESULT_LIMIT:
                break
    return results


def _workspace_meta_from_row(row):
    if not row:
        return _workspace_metadata_defaults()
    network_meta = _json_loads(row["network_json"], None)
    account_meta = _json_loads(row["account_data_json"], None)
    kml_meta = _json_loads(row["kml_overlay_json"], None)
    total_bytes = int((network_meta or {}).get("sizeBytes", 0) or 0) + int((account_meta or {}).get("sizeBytes", 0) or 0) + int((kml_meta or {}).get("sizeBytes", 0) or 0)
    threshold = int(app.config.get("WORKSPACE_LAZY_RESTORE_BYTES", 1024 * 1024) or 1024 * 1024)
    recovery_warnings = _workspace_component_recovery_warnings(
        row["user_id"],
        network_meta=network_meta,
        account_meta=account_meta,
        kml_meta=kml_meta,
    )
    return {
        "totalBytes": total_bytes,
        "requiresManualRestore": total_bytes > threshold,
        "isLarge": total_bytes > threshold,
        "updatedAt": row["updated_at"] or None,
        "feederFileName": row["feeder_file_name"] or "",
        "network": network_meta,
        "accountData": account_meta,
        "kmlOverlay": kml_meta,
        "recoveryWarnings": recovery_warnings,
    }


def get_user_workspace_metadata(user_id):
    if not user_id:
        return _workspace_metadata_defaults()

    with get_app_db_read_connection() as connection:
        row = connection.execute(
            """
            SELECT
                user_id,
                feeder_file_name,
                updated_at,
                network_json,
                account_data_json,
                kml_overlay_json
            FROM user_workspace
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()

    row = _repair_workspace_metadata_if_needed(row)
    return _workspace_meta_from_row(row)


def get_user_workspace(user_id, include_payload=True):
    if not user_id:
        return _empty_workspace_payload()

    metadata = get_user_workspace_metadata(user_id)
    if not include_payload:
        payload = _workspace_stub_payload(
            feeder_file_name=metadata.get("feederFileName", ""),
            updated_at=metadata.get("updatedAt"),
        )
        payload["recoveryWarnings"] = list(metadata.get("recoveryWarnings", []))
        return payload

    with get_app_db_read_connection() as connection:
        row = connection.execute(
            """
            SELECT
                user_id,
                feeder_file_name,
                network_json,
                feeder_validation_json,
                account_data_json,
                xlsx_validation_json,
                kml_overlay_json,
                kml_validation_json,
                updated_at
            FROM user_workspace
            WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()

    row = _repair_workspace_metadata_if_needed(row)
    if not row:
        return _empty_workspace_payload()

    network_meta = _json_loads(row["network_json"], None) or {}
    account_meta = _json_loads(row["account_data_json"], None) or {}
    kml_meta = _json_loads(row["kml_overlay_json"], None) or {}
    recovery_warnings = []
    payload = {
        "feederFileName": row["feeder_file_name"] or "",
        "network": None,
        "accountData": None,
        "kmlOverlay": None,
        "validationReports": {
            "feeder": _json_loads(row["feeder_validation_json"], None),
            "xlsx": _json_loads(row["xlsx_validation_json"], None),
            "kml": _json_loads(row["kml_validation_json"], None),
        },
        "updatedAt": row["updated_at"] or None,
        "recoveryWarnings": recovery_warnings,
    }

    if network_meta:
        network_payload = _read_workspace_cache_payload(user_id, network_meta.get("cacheName", "network"))
        if network_payload is None:
            recovery_warnings.append("Feeder workspace cache is missing or unreadable.")
        else:
            payload["network"] = network_payload

    if account_meta:
        cache_name = account_meta.get("cacheName", "account_data")
        cache_size = _workspace_cache_size(user_id, cache_name)
        if cache_size <= 0:
            recovery_warnings.append("XLSX workspace cache is missing or unreadable.")
        else:
            payload["accountData"] = {
                "headers": list(account_meta.get("headers", [])),
                "row_count": int(account_meta.get("rowCount", 0) or 0),
                "timings": dict(account_meta.get("timings", {})),
                "validation": payload["validationReports"]["xlsx"] or {},
                "records": [],
                "serverBacked": True,
                "cacheName": cache_name,
            }

    if kml_meta:
        kml_payload = _read_workspace_cache_payload(user_id, kml_meta.get("cacheName", "kml_overlay"))
        if kml_payload is None:
            recovery_warnings.append("KML workspace cache is missing or unreadable.")
        else:
            payload["kmlOverlay"] = kml_payload

    return payload


def upsert_user_workspace(user_id, **workspace_updates):
    if not user_id:
        return _empty_workspace_payload()

    existing_metadata = get_user_workspace_metadata(user_id)
    feeder_file_name = workspace_updates["feederFileName"] if "feederFileName" in workspace_updates else None
    network_meta = existing_metadata.get("network")
    account_meta = existing_metadata.get("accountData")
    kml_meta = existing_metadata.get("kmlOverlay")

    if "network" in workspace_updates:
        if workspace_updates["network"] is None:
            if network_meta:
                _remove_workspace_cache_payload(user_id, network_meta.get("cacheName", "network"))
            network_meta = None
            feeder_file_name = ""
        else:
            network_payload = _compact_network_data(workspace_updates["network"])
            cache_info = _write_workspace_cache_payload(user_id, "network", network_payload)
            network_meta = _network_workspace_meta(network_payload, cache_info)
    if "accountData" in workspace_updates:
        _clear_user_cache_entries(ACCOUNT_QUERY_CACHE, user_id)
        if workspace_updates["accountData"] is None:
            if account_meta:
                _remove_workspace_cache_payload(user_id, account_meta.get("cacheName", "account_data"))
            account_meta = None
        else:
            account_payload = _compact_account_data(workspace_updates["accountData"])
            cache_info = _write_workspace_cache_payload(user_id, "account_data", account_payload)
            account_meta = _account_workspace_meta(account_payload, cache_info)
            cache_mtime = None
            try:
                cache_mtime = os.path.getmtime(cache_info.get("cachePath"))
            except OSError:
                cache_mtime = None
            if cache_mtime is not None:
                _cache_account_query_entry((user_id, cache_info.get("cacheName", "account_data"), cache_mtime), account_payload)
    if "kmlOverlay" in workspace_updates:
        _clear_user_cache_entries(KML_FEATURE_CACHE, user_id)
        if workspace_updates["kmlOverlay"] is None:
            if kml_meta:
                _remove_workspace_cache_payload(user_id, kml_meta.get("cacheName", "kml_overlay"))
            kml_meta = None
        else:
            kml_payload = _compact_kml_overlay(workspace_updates["kmlOverlay"])
            cache_info = _write_workspace_cache_payload(user_id, "kml_overlay", kml_payload)
            kml_meta = _kml_workspace_meta(kml_payload, cache_info)

    feeder_validation = workspace_updates["feederValidation"] if "feederValidation" in workspace_updates else None
    xlsx_validation = workspace_updates["xlsxValidation"] if "xlsxValidation" in workspace_updates else None
    kml_validation = workspace_updates["kmlValidation"] if "kmlValidation" in workspace_updates else None

    with get_app_db_connection() as connection:
        connection.execute(
            """
            INSERT INTO user_workspace (
                user_id,
                feeder_file_name,
                network_json,
                feeder_validation_json,
                account_data_json,
                xlsx_validation_json,
                kml_overlay_json,
                kml_validation_json,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                feeder_file_name = COALESCE(excluded.feeder_file_name, user_workspace.feeder_file_name),
                network_json = COALESCE(excluded.network_json, user_workspace.network_json),
                feeder_validation_json = COALESCE(excluded.feeder_validation_json, user_workspace.feeder_validation_json),
                account_data_json = COALESCE(excluded.account_data_json, user_workspace.account_data_json),
                xlsx_validation_json = COALESCE(excluded.xlsx_validation_json, user_workspace.xlsx_validation_json),
                kml_overlay_json = COALESCE(excluded.kml_overlay_json, user_workspace.kml_overlay_json),
                kml_validation_json = COALESCE(excluded.kml_validation_json, user_workspace.kml_validation_json),
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                user_id,
                feeder_file_name,
                _json_dumps(network_meta, None, compact=True) if network_meta is not None else None,
                _json_dumps(_validation_summary(feeder_validation), None, compact=True) if "feederValidation" in workspace_updates else None,
                _json_dumps(account_meta, None, compact=True) if account_meta is not None else None,
                _json_dumps(_validation_summary(xlsx_validation), None, compact=True) if "xlsxValidation" in workspace_updates else None,
                _json_dumps(kml_meta, None, compact=True) if kml_meta is not None else None,
                _json_dumps(_validation_summary(kml_validation), None, compact=True) if "kmlValidation" in workspace_updates else None,
            ),
        )
        connection.commit()
    return {
        "success": True,
        "metadata": get_user_workspace_metadata(user_id),
    }


def clear_user_workspace(user_id):
    if not user_id:
        return False

    _clear_workspace_cache(user_id)
    with get_app_db_connection() as connection:
        cursor = connection.execute("DELETE FROM user_workspace WHERE user_id = ?", (user_id,))
        connection.commit()
    return cursor.rowcount > 0


def get_available_audit_actions():
    return [
        "login_success",
        "login_failure",
        "logout",
        "feeder_upload_attempt",
        "feeder_upload_success",
        "feeder_upload_failure",
        "feeder_upload",
        "xlsx_upload_attempt",
        "xlsx_upload_success",
        "xlsx_upload_failure",
        "xlsx_upload",
        "kml_upload_attempt",
        "kml_upload_success",
        "kml_upload_failure",
        "kml_upload",
        "export_interruption",
        "export_disconnected_fragments",
        "create_user",
        "update_role",
        "reset_password",
        "delete_user",
        "save_interruption",
        "delete_interruption",
        "clear_workspace",
    ]


def list_interruption_rows():
    with get_app_db_read_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                name,
                start_date,
                start_time,
                end_date,
                end_time,
                context_type,
                target_name,
                source_tower_clicked,
                clicked_tower_json,
                clicked_line_index,
                affected_towers_json,
                matched_rows_json,
                line_indexes_json,
                tower_indexes_json,
                kml_feature_ids_json,
                kml_feature_json,
                audit_json,
                feeder_name,
                affected_poles_count,
                affected_accounts_count,
                matched_rows_count,
                trace_confidence,
                monitoring_status,
                action_taken,
                restored_date,
                restored_time,
                remarks,
                created_by,
                created_at
            FROM interruptions
            ORDER BY datetime(created_at) DESC, id DESC
            """
        ).fetchall()
    return rows


def list_interruption_summary_rows():
    with get_app_db_read_connection() as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                name,
                start_date,
                start_time,
                end_date,
                end_time,
                context_type,
                target_name,
                source_tower_clicked,
                feeder_name,
                affected_poles_count,
                affected_accounts_count,
                matched_rows_count,
                trace_confidence,
                monitoring_status,
                action_taken,
                restored_date,
                restored_time,
                remarks,
                created_by,
                created_at
            FROM interruptions
            ORDER BY datetime(created_at) DESC, id DESC
            """
        ).fetchall()
    return rows


def _normalize_filter_text(value):
    return str(value or "").strip()


def _normalize_filter_date(value):
    text = _normalize_filter_text(value)
    if len(text) >= 10:
        return text[:10]
    return text


def _interruption_filter_date(record):
    start_date = _normalize_filter_date(record.get("startDate"))
    if start_date:
        return start_date
    created_at = _normalize_filter_text(record.get("createdAt"))
    if len(created_at) >= 10:
        return created_at[:10]
    return ""


def filter_interruption_records(records, *, name="", date_from="", date_to="", created_by="", trace_confidence=""):
    name_query = _normalize_filter_text(name).lower()
    created_by_query = _normalize_filter_text(created_by).lower()
    date_from_value = _normalize_filter_date(date_from)
    date_to_value = _normalize_filter_date(date_to)
    trace_confidence_value = _normalize_filter_text(trace_confidence).lower()

    filtered = []
    for record in records:
        record_name = _normalize_filter_text(record.get("name")).lower()
        record_creator = _normalize_filter_text(record.get("createdBy")).lower()
        record_confidence = _normalize_filter_text(record.get("traceConfidence", "confirmed")).lower()
        record_date = _interruption_filter_date(record)

        if name_query and name_query not in record_name:
            continue
        if created_by_query and created_by_query not in record_creator:
            continue
        if trace_confidence_value and trace_confidence_value != record_confidence:
            continue
        if date_from_value and record_date and record_date < date_from_value:
            continue
        if date_from_value and not record_date:
            continue
        if date_to_value and record_date and record_date > date_to_value:
            continue
        if date_to_value and not record_date:
            continue
        filtered.append(record)
    return filtered


def get_available_trace_confidence_filters():
    return ["confirmed", "mixed", "guessed"]


def get_interruption_row(interruption_id):
    with get_app_db_read_connection() as connection:
        return connection.execute(
            """
            SELECT
                id,
                name,
                start_date,
                start_time,
                end_date,
                end_time,
                context_type,
                target_name,
                source_tower_clicked,
                clicked_tower_json,
                clicked_line_index,
                affected_towers_json,
                matched_rows_json,
                line_indexes_json,
                tower_indexes_json,
                kml_feature_ids_json,
                kml_feature_json,
                audit_json,
                feeder_name,
                affected_poles_count,
                affected_accounts_count,
                matched_rows_count,
                trace_confidence,
                monitoring_status,
                action_taken,
                restored_date,
                restored_time,
                remarks,
                created_by,
                created_at
            FROM interruptions
            WHERE id = ?
            """,
            (interruption_id,),
        ).fetchone()


def create_interruption_record(payload, created_by):
    normalized_payload = create_interruption_payload({
        **payload,
        "user": created_by,
    })

    clicked_tower = payload.get("clicked_tower")
    if clicked_tower is not None and not isinstance(clicked_tower, dict):
        clicked_tower = None

    kml_feature = payload.get("kml_feature")
    if kml_feature is not None and not isinstance(kml_feature, dict):
        kml_feature = None

    audit = payload.get("audit")
    if audit is not None and not isinstance(audit, dict):
        audit = None

    clicked_line_index = payload.get("clicked_line_index")
    try:
        clicked_line_index = int(clicked_line_index) if clicked_line_index is not None else None
    except (TypeError, ValueError):
        clicked_line_index = None

    affected_towers = payload.get("affected_towers") or []
    matched_rows = payload.get("matched_rows") or []
    trace_confidence = (
        (audit or {}).get("trace_confidence")
        or normalized_payload.get("trace_confidence")
        or "confirmed"
    )
    affected_poles_count = _count_affected_pol_ids(affected_towers)
    affected_accounts_count = _count_unique_accounts(matched_rows)
    matched_rows_count = len(matched_rows) if isinstance(matched_rows, list) else 0
    monitoring = normalize_monitoring_fields(
        payload,
        existing={
            "startDate": normalized_payload["start_date"],
            "startTime": normalized_payload["start_time"],
            "restoredDate": normalized_payload["end_date"],
            "restoredTime": normalized_payload["end_time"],
        },
    )

    with get_app_db_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO interruptions (
                name,
                start_date,
                start_time,
                end_date,
                end_time,
                context_type,
                target_name,
                source_tower_clicked,
                clicked_tower_json,
                clicked_line_index,
                affected_towers_json,
                matched_rows_json,
                line_indexes_json,
                tower_indexes_json,
                kml_feature_ids_json,
                kml_feature_json,
                audit_json,
                feeder_name,
                affected_poles_count,
                affected_accounts_count,
                matched_rows_count,
                trace_confidence,
                monitoring_status,
                action_taken,
                restored_date,
                restored_time,
                remarks,
                created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized_payload["name"],
                normalized_payload["start_date"],
                normalized_payload["start_time"],
                normalized_payload["end_date"],
                normalized_payload["end_time"],
                normalized_payload["context_type"],
                normalized_payload["target_name"],
                normalized_payload["source_tower_clicked"],
                _json_dumps(clicked_tower, None),
                clicked_line_index,
                _json_dumps(payload.get("affected_towers"), []),
                _json_dumps(payload.get("matched_rows"), []),
                _json_dumps(payload.get("line_indexes"), []),
                _json_dumps(payload.get("tower_indexes"), []),
                _json_dumps(payload.get("kml_feature_ids"), []),
                _json_dumps(kml_feature, None),
                _json_dumps(audit, None),
                normalized_payload["feeder_name"],
                affected_poles_count,
                affected_accounts_count,
                matched_rows_count,
                trace_confidence,
                monitoring["status"],
                monitoring["actionTaken"],
                monitoring["restoredDate"],
                monitoring["restoredTime"],
                monitoring["remarks"],
                created_by,
            ),
        )
        connection.commit()
        created_id = cursor.lastrowid
    return get_interruption_row(created_id)


def delete_interruption_record(interruption_id):
    with get_app_db_connection() as connection:
        cursor = connection.execute("DELETE FROM interruptions WHERE id = ?", (interruption_id,))
        connection.commit()
    return cursor.rowcount > 0


def delete_all_interruption_records():
    backup_path = create_timestamped_backup(app.config["AUTH_DB_PATH"], app.config["BACKUP_DIR"])
    with get_app_db_connection() as connection:
        count_row = connection.execute("SELECT COUNT(*) AS total FROM interruptions").fetchone()
        total_rows = int((count_row["total"] if count_row else 0) or 0)
        if total_rows > 0:
            connection.execute("DELETE FROM interruptions")
        connection.commit()
    maybe_maintain_wal(force=True)
    return {
        "deleted_rows": total_rows,
        "backup_path": backup_path,
    }


def update_interruption_monitoring_record(interruption_id, payload):
    existing = serialize_interruption_row(get_interruption_row(interruption_id))
    if not existing:
        return None
    monitoring = normalize_monitoring_fields(payload, existing=existing)
    with get_app_db_connection() as connection:
        cursor = connection.execute(
            """
            UPDATE interruptions
            SET monitoring_status = ?,
                action_taken = ?,
                restored_date = ?,
                restored_time = ?,
                remarks = ?
            WHERE id = ?
            """,
            (
                monitoring["status"],
                monitoring["actionTaken"],
                monitoring["restoredDate"],
                monitoring["restoredTime"],
                monitoring["remarks"],
                interruption_id,
            ),
        )
        connection.commit()
    if cursor.rowcount <= 0:
        return None
    return get_interruption_row(interruption_id)


def build_saved_interruption_export(interruption_id):
    row = get_interruption_row(interruption_id)
    if not row:
        return None, None

    interruption = serialize_interruption_row(row)
    export_payload = {
        "name": interruption["name"],
        "start_date": interruption["startDate"],
        "start_time": interruption["startTime"],
        "end_date": interruption["endDate"],
        "end_time": interruption["endTime"],
        "target_name": interruption["targetName"],
        "context_type": interruption["contextType"],
        "affected_towers": interruption["affectedTowers"],
        "matched_rows": interruption["matchedRows"],
        "line_indexes": interruption["lineIndexes"],
        "kml_feature": interruption["kmlFeature"],
        "source_tower_clicked": interruption["sourceTowerClicked"] or interruption["targetName"],
        "feeder_name": interruption["feederName"],
        "trace_confidence": interruption.get("traceConfidence", "confirmed"),
        "inferred_nodes_count": (interruption.get("audit") or {}).get("inferred_nodes_count", 0),
        "inferred_accounts_count": (interruption.get("audit") or {}).get("inferred_accounts_count", 0),
        "total_affected_towers": interruption.get("totalPolId", 0),
        "total_affected_accounts": interruption.get("totalAffectedAccounts", 0),
        "user": interruption["createdBy"],
    }
    return interruption, create_interruption_payload(export_payload)


def _is_safe_redirect_target(target):
    if not target:
        return False
    ref_url = urlparse(request.host_url)
    test_url = urlparse(urljoin(request.host_url, target))
    return test_url.scheme in ("http", "https") and ref_url.netloc == test_url.netloc


def _wants_json_response():
    accept_header = request.headers.get("Accept", "")
    return request.is_json or "application/json" in accept_header.lower()


def api_response(*, success, message="", status_code=200, **payload):
    response_payload = {"success": bool(success)}
    if message:
        response_payload["message"] = message
    response_payload.update(payload)
    return jsonify(response_payload), status_code


def api_success(message="", status_code=200, **payload):
    return api_response(success=True, message=message, status_code=status_code, **payload)


def api_error(message, status_code=400, **payload):
    return api_response(success=False, message=message, status_code=status_code, **payload)


def _admin_response(success_message, error_message="", status_code=200):
    if _wants_json_response():
        return api_response(
            success=not bool(error_message),
            message=error_message or success_message,
            status_code=status_code,
        )
    if error_message:
        flash(error_message, "error")
    elif success_message:
        flash(success_message, "success")
    return redirect(url_for("admin_users"))


def _extension_of(filename):
    return os.path.splitext(str(filename or "").strip().lower())[1]


def _safe_file_size(file_storage):
    content_length = getattr(file_storage, "content_length", None)
    if isinstance(content_length, int) and content_length > 0:
        return content_length

    stream = getattr(file_storage, "stream", None)
    if not stream or not hasattr(stream, "seek") or not hasattr(stream, "tell"):
        return content_length if isinstance(content_length, int) else None

    current_pos = stream.tell()
    stream.seek(0, os.SEEK_END)
    size = stream.tell()
    stream.seek(current_pos)
    return size


def _upload_error(message, validation=None, status_code=400):
    payload_validation = finalize_validation(validation or make_validation())
    return api_error(message, status_code=status_code, validation=payload_validation)


def validate_upload_file(file_storage, *, file_kind, max_size_bytes):
    validation = make_validation()
    kind_label = str(file_kind or "file").strip() or "file"

    if not file_storage:
        validation["errors"].append(f"No {kind_label} was uploaded.")
        return False, _upload_error(f"No {kind_label} was uploaded.", validation)

    filename = str(file_storage.filename or "").strip()
    if not filename:
        validation["errors"].append(f"No {kind_label} file was selected.")
        return False, _upload_error(f"No {kind_label} file was selected.", validation)

    size = _safe_file_size(file_storage)
    if size == 0:
        validation["errors"].append(f"The uploaded {kind_label} file is empty.")
        return False, _upload_error(f"Empty upload. The uploaded {kind_label} file is empty.", validation)
    if isinstance(size, int) and size > max_size_bytes:
        max_mb = round(max_size_bytes / (1024 * 1024), 1)
        validation["errors"].append(f"The uploaded {kind_label} file exceeds the maximum allowed size.")
        return False, _upload_error(
            f"The uploaded {kind_label} file is too large. Maximum allowed size is {max_mb} MB.",
            validation,
            413,
        )

    stream = getattr(file_storage, "stream", None)
    if stream and hasattr(stream, "seek"):
        stream.seek(0)
    return True, None


def build_upload_failure_message(file_kind, message):
    normalized_kind = str(file_kind or "").strip().lower()
    hints = {
        "feeder": "How to fix: upload a readable GPX file with feeder points or route coordinates, and confirm the source/substation point is present.",
        "xlsx": "How to fix: use an Excel .xlsx file with Pol ID and Account Number or FromBusID/ToBusID columns, and keep KWHR rows numeric where possible.",
        "kml": "How to fix: upload a KML file with Placemark geometry (Point, LineString, Polygon, or MultiGeometry) and save it as plain .kml, not KMZ.",
    }
    hint = hints.get(normalized_kind)
    return f"{message} {hint}".strip() if hint else message


def log_upload_outcome(audit_prefix, uploaded_file, status, message, **details):
    filename = str(getattr(uploaded_file, "filename", "") or "").strip()
    payload = {
        "filename": filename,
        "size_bytes": _safe_file_size(uploaded_file),
        "status_message": message,
    }
    payload.update(details)
    log_audit_event(f"{audit_prefix}_{status}", details=payload)


def debug_upload_event(route_name, uploaded_file, status, message):
    if not app.config.get("DEBUG", False):
        return
    file_size = _safe_file_size(uploaded_file)
    filename = str(getattr(uploaded_file, "filename", "") or "").strip()
    print(f"[upload-debug] route={route_name} status={status} filename={filename!r} size_bytes={file_size} message={message}")


@app.errorhandler(413)
def handle_request_entity_too_large(_error):
    validation = make_validation()
    validation["errors"].append("The uploaded file exceeded the department upload size limit.")
    if request.path.startswith("/upload"):
        return _upload_error(
            "The uploaded file is too large for this system. Please reduce the file size and try again.",
            validation,
            413,
        )
    return api_error("The request payload is too large.", status_code=413)


@app.errorhandler(DatabaseBusyError)
def handle_database_busy(_error):
    message = get_friendly_database_error_message()
    if request.path.startswith("/upload") or request.path.startswith("/interruptions") or request.path.startswith("/workspace"):
        return api_error(message, status_code=503)
    flash(message, "error")
    return redirect(url_for("index"))


@app.errorhandler(sqlite3.OperationalError)
def handle_sqlite_operational_error(error):
    if "locked" in str(error).lower():
        return handle_database_busy(error)
    message = "A database error occurred while processing your request."
    if request.path.startswith("/upload") or request.path.startswith("/interruptions") or request.path.startswith("/workspace") or request.path.startswith("/export"):
        return api_error(message, status_code=500)
    flash(message, "error")
    return redirect(url_for("index"))


@app.before_request
def load_authenticated_user():
    user_id = session.get("user_id")
    g.current_user = get_user_by_id(app.config["AUTH_DB_PATH"], user_id) if user_id else None


@app.after_request
def apply_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    if request.endpoint in {"login", "logout"}:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


CSRF_PROTECTED_ENDPOINTS = {
    "login": "login",
    "logout": "index",
    "create_interruption": "index",
    "delete_interruption": "index",
    "update_interruption_monitoring": "index",
    "admin_users_create": "admin_users",
    "admin_users_update_role": "admin_users",
    "admin_users_reset_password": "admin_users",
    "admin_users_delete": "admin_users",
    "audit_logs_prune": "audit_logs",
    "audit_logs_delete_all": "audit_logs",
    "delete_interruption_from_records": "records_history",
    "clear_current_workspace": "index",
    "upload": "index",
    "upload_xlsx": "index",
    "upload_kml": "index",
    "export_interruption": "index",
    "export_disconnected_fragments": "index",
}


def _csrf_error_response(message, fallback_endpoint):
    if request.endpoint == "login":
        next_url = str(request.form.get("next") or request.args.get("next") or "").strip()
        return render_template("login.html", error_message=message, next_url=next_url), 400
    if request.is_json or request.path.startswith("/upload") or request.path.startswith("/workspace") or request.path.startswith("/interruptions") or request.path.startswith("/export"):
        return api_error(message)
    flash(message, "error")
    return redirect(url_for(fallback_endpoint))


@app.before_request
def protect_form_posts_with_csrf():
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return None

    fallback_endpoint = CSRF_PROTECTED_ENDPOINTS.get(request.endpoint)
    if not fallback_endpoint:
        return None

    submitted_token = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
    if validate_csrf_token(submitted_token):
        return None

    return _csrf_error_response("Security token missing or invalid. Refresh the page and try again.", fallback_endpoint)


@app.context_processor
def inject_auth_context():
    current_user = serialize_user(getattr(g, "current_user", None))
    current_permissions = get_role_permissions(current_user["role"]) if current_user else get_role_permissions("viewer")
    visible_seed_info = (
        SEED_ADMIN_INFO
        if app.config["IS_DEVELOPMENT"] and app.config["SHOW_SEEDED_ADMIN_CREDENTIALS"]
        else {"created": False, "username": "", "password": None}
    )
    return {
        "current_user": current_user,
        "current_permissions": current_permissions,
        "seed_admin_info": visible_seed_info,
        "outage_env": app.config["OUTAGE_ENV"],
        "is_development": app.config["IS_DEVELOPMENT"],
        "csrf_token": get_or_create_csrf_token(),
    }


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.current_user:
        return redirect(url_for("index"))

    error_message = ""
    next_url = request.args.get("next", "")

    if request.method == "POST":
        username = str(request.form.get("username") or "").strip()
        password = str(request.form.get("password") or "")
        next_url = str(request.form.get("next") or "").strip()
        user = authenticate_user(app.config["AUTH_DB_PATH"], username, password)
        if not user:
            error_message = "Invalid username or password."
            log_audit_event(
                "login_failure",
                details={
                    "attempted_username": username,
                    "ip": request.headers.get("X-Forwarded-For", request.remote_addr or ""),
                    "user_agent": request.headers.get("User-Agent", ""),
                },
                username=username or "anonymous",
                role="unknown",
            )
        else:
            session.permanent = True
            login_user(user)
            log_audit_event(
                "login_success",
                details={
                    "ip": request.headers.get("X-Forwarded-For", request.remote_addr or ""),
                    "user_agent": request.headers.get("User-Agent", ""),
                },
                username=user["username"],
                role=user["role"],
            )
            if _is_safe_redirect_target(next_url):
                return redirect(next_url)
            return redirect(url_for("index"))

    return render_template("login.html", error_message=error_message, next_url=next_url)


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    log_audit_event("logout")
    logout_user()
    return redirect(url_for("login"))


@app.route("/")
@login_required
def index():
    return render_template("dashboard.html", dashboard=build_dashboard_model())


@app.route("/dashboard/data", methods=["GET"])
@login_required
def dashboard_data():
    filters = {
        "status": request.args.get("status", ""),
        "substation": request.args.get("substation", ""),
        "feeder": request.args.get("feeder", ""),
        "created_by": request.args.get("created_by", ""),
        "date_from": request.args.get("date_from", ""),
        "date_to": request.args.get("date_to", ""),
        "search": request.args.get("search", ""),
    }
    return jsonify({
        "success": True,
        "dashboard": build_dashboard_model(filters=filters),
    })


@app.route("/operations")
@login_required
def operations():
    return render_template("index.html")


@app.route("/workspace/current", methods=["GET"])
@login_required
def get_current_workspace():
    user_id = g.current_user["id"] if g.current_user else None
    include_payload = request.args.get("full", "").strip() == "1"
    metadata = get_user_workspace_metadata(user_id)
    workspace = get_user_workspace(user_id, include_payload=include_payload or not metadata.get("requiresManualRestore"))
    return api_success(workspace=workspace, metadata=metadata)


@app.route("/workspace/current/clear", methods=["POST"])
@login_required
def clear_current_workspace():
    clear_user_workspace(g.current_user["id"] if g.current_user else None)
    log_audit_event("clear_workspace", details={"source": "main_page"})
    return api_success("Current workspace cleared successfully.")


@app.route("/account_mapping/query", methods=["POST"])
@login_required
def account_mapping_query():
    payload = request.get_json(silent=True) or {}
    tower_names = payload.get("tower_names") or []
    kml_feature_ids = payload.get("kml_feature_ids") or []
    matched_rows = _query_account_rows_for_towers(
        g.current_user["id"] if g.current_user else None,
        tower_names=tower_names,
        kml_feature_ids=kml_feature_ids,
    )
    return api_success(matched_rows=matched_rows)


@app.route("/account_mapping/search", methods=["POST"])
@login_required
def account_mapping_search():
    payload = request.get_json(silent=True) or {}
    query = str(payload.get("query") or "").strip()
    matched_rows = _search_account_rows(g.current_user["id"] if g.current_user else None, query)
    return api_success(matched_rows=matched_rows)


@app.route("/records", methods=["GET"])
@role_required("can_view_records")
def records_history():
    filters = {
        "name": _normalize_filter_text(request.args.get("name")),
        "date_from": _normalize_filter_date(request.args.get("date_from")),
        "date_to": _normalize_filter_date(request.args.get("date_to")),
        "created_by": _normalize_filter_text(request.args.get("created_by")),
        "trace_confidence": _normalize_filter_text(request.args.get("trace_confidence")).lower(),
    }
    all_records = [serialize_interruption_summary_row(row) for row in list_interruption_summary_rows()]
    filtered_records = filter_interruption_records(all_records, **filters)
    can_delete_records = bool(g.current_user and g.current_user["role"] in {"admin", "supervisor"})
    return render_template(
        "records_history.html",
        records=filtered_records,
        filters=filters,
        trace_confidence_options=get_available_trace_confidence_filters(),
        can_delete_records=can_delete_records,
        total_records=len(all_records),
        filtered_count=len(filtered_records),
    )


@app.route("/audit-logs", methods=["GET"])
@role_required("can_view_audit_logs")
def audit_logs():
    filters = {
        "date_from": str(request.args.get("date_from") or "").strip(),
        "date_to": str(request.args.get("date_to") or "").strip(),
        "username": str(request.args.get("username") or "").strip(),
        "action": str(request.args.get("action") or "").strip(),
    }
    logs = [
        serialize_audit_log_row(row)
        for row in list_audit_log_rows(
            date_from=filters["date_from"],
            date_to=filters["date_to"],
            username=filters["username"],
            action_type=filters["action"],
        )
    ]
    return render_template(
        "audit_logs.html",
        logs=logs,
        filters=filters,
        audit_actions=get_available_audit_actions(),
        can_manage_audit_logs=bool(g.current_user and g.current_user["role"] == "admin"),
    )


@app.route("/audit-logs/prune", methods=["POST"])
@role_required("can_manage_audit_logs")
def audit_logs_prune():
    try:
        result = prune_audit_logs(force=True, raise_on_error=True)
        deleted_rows = int(result.get("deleted_rows", 0) or 0)
        flash(f"Audit log pruning completed. Removed {deleted_rows} old log row(s).", "success")
    except DatabaseBusyError as exc:
        flash(str(exc), "error")
    except Exception as exc:
        flash(f"Audit log pruning failed: {exc}", "error")
    return redirect(url_for("audit_logs"))


@app.route("/audit-logs/delete-all", methods=["POST"])
@role_required("can_manage_audit_logs")
def audit_logs_delete_all():
    confirmation = str(request.form.get("confirmation") or "").strip()
    if confirmation != "DELETE":
        flash("Type DELETE exactly to confirm deleting all audit logs.", "error")
        return redirect(url_for("audit_logs"))

    try:
        result = delete_all_audit_logs()
        deleted_rows = int(result.get("deleted_rows", 0) or 0)
        flash(f"Deleted all audit logs. Removed {deleted_rows} row(s).", "success")
        if result.get("maintenance_warning"):
            flash(
                f"Audit log rows were deleted, but SQLite cleanup was delayed: {result['maintenance_warning']}",
                "error",
            )
    except DatabaseBusyError as exc:
        flash(str(exc), "error")
    except Exception as exc:
        flash(f"Delete-all audit log maintenance failed: {exc}", "error")
    return redirect(url_for("audit_logs"))


@app.route("/admin/system-status", methods=["GET"])
@role_required("can_manage_users")
def admin_system_status():
    return render_template("admin_status.html", system_status=get_system_status_snapshot())


@app.route("/interruptions", methods=["GET"])
@login_required
def list_interruptions():
    interruptions = [serialize_interruption_summary_row(row) for row in list_interruption_summary_rows()]
    return api_success(interruptions=interruptions)


@app.route("/interruptions", methods=["POST"])
@role_required("can_edit_interruption")
def create_interruption():
    payload = request.get_json(silent=True) or {}
    if not payload:
        return api_error("No interruption payload was provided.")

    try:
        row = create_interruption_record(payload, g.current_user["username"] if g.current_user else "Unknown User")
        saved_interruption = serialize_interruption_row(row)
        log_audit_event(
            "save_interruption",
            details={
                "interruption_id": saved_interruption["id"],
                "name": saved_interruption["name"],
                "target_name": saved_interruption["targetName"],
                "context_type": saved_interruption["contextType"],
                "feeder_name": saved_interruption["feederName"],
            },
        )
        return api_success("Interruption saved successfully.", interruption=saved_interruption)
    except Exception as exc:
        return api_error(str(exc))


@app.route("/interruptions/<int:interruption_id>", methods=["GET"])
@login_required
def get_interruption(interruption_id):
    row = get_interruption_row(interruption_id)
    if not row:
        return api_error("Interruption not found.", status_code=404)
    return api_success(interruption=serialize_interruption_row(row))


@app.route("/interruptions/<int:interruption_id>", methods=["DELETE"])
@role_required("can_edit_interruption")
def delete_interruption(interruption_id):
    row = get_interruption_row(interruption_id)
    if not row:
        return api_error("Interruption not found.", status_code=404)

    deleted = delete_interruption_record(interruption_id)
    if not deleted:
        return api_error("Interruption could not be deleted.")
    deleted_interruption = serialize_interruption_row(row)
    log_audit_event(
        "delete_interruption",
        details={
            "interruption_id": deleted_interruption["id"],
            "name": deleted_interruption["name"],
            "target_name": deleted_interruption["targetName"],
        },
    )
    return api_success("Interruption deleted successfully.")


@app.route("/interruptions/delete-all", methods=["POST"])
@role_required("can_manage_users")
def delete_all_interruptions():
    payload = request.get_json(silent=True) or {}
    confirmation = str(payload.get("confirmation") or "").strip()
    if confirmation != "DELETE ALL":
        return api_error("Type DELETE ALL to confirm deleting every interruption record.", status_code=400)

    try:
        result = delete_all_interruption_records()
    except DatabaseBusyError as exc:
        return api_error(get_friendly_database_error_message(exc), status_code=503)
    except Exception as exc:
        return api_error(str(exc), status_code=500)

    log_audit_event(
        "delete_interruption",
        details={
            "source": "dashboard_bulk_delete",
            "deleted_rows": result["deleted_rows"],
            "backup_path": result["backup_path"],
        },
    )
    return api_success(
        f"Deleted {result['deleted_rows']} interruption record(s). A database backup was created first.",
        deletedRows=result["deleted_rows"],
        backupPath=result["backup_path"],
        dashboard=build_dashboard_model(),
    )


@app.route("/interruptions/<int:interruption_id>/monitoring", methods=["PATCH"])
@role_required("can_edit_interruption")
def update_interruption_monitoring(interruption_id):
    payload = request.get_json(silent=True) or {}
    row = update_interruption_monitoring_record(interruption_id, payload)
    if not row:
        return api_error("Interruption not found.", status_code=404)
    interruption = serialize_interruption_row(row)
    log_audit_event(
        "update_interruption_monitoring",
        details={
            "interruption_id": interruption["id"],
            "name": interruption["name"],
            "status": interruption["status"],
            "action_taken": interruption["actionTaken"],
        },
    )
    return api_success("Interruption monitoring updated.", interruption=interruption, dashboard=build_dashboard_model())


@app.route("/interruptions/<int:interruption_id>/export", methods=["GET"])
@role_required("can_export")
def export_saved_interruption(interruption_id):
    interruption, export_payload = build_saved_interruption_export(interruption_id)
    if not interruption or not export_payload:
        return render_template(
            "error.html",
            error_title="Record Not Found",
            error_message="The interruption record you tried to export no longer exists.",
        ), 404

    log_audit_event(
        "export_interruption",
        details={
            "interruption_id": interruption["id"],
            "name": interruption["name"],
            "target_name": interruption["targetName"],
            "feeder_name": interruption["feederName"],
            "trace_confidence": interruption.get("traceConfidence", "confirmed"),
            "source": "records_history",
        },
    )
    workbook_stream = build_interruption_workbook(export_payload)
    safe_name = export_payload["name"].replace(" ", "_")
    start_date = export_payload.get("start_date", "")
    start_time = export_payload.get("start_time", "").replace(":", "-")
    end_date = export_payload.get("end_date", "")
    end_time = export_payload.get("end_time", "").replace(":", "-")
    filename = f"{safe_name}_{start_date}_{start_time}_to_{end_date}_{end_time}.xlsx"

    return send_file(
        workbook_stream,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.route("/records/interruptions/<int:interruption_id>/delete", methods=["POST"])
@role_required("can_delete_saved_records")
def delete_interruption_from_records(interruption_id):
    row = get_interruption_row(interruption_id)
    if not row:
        flash("The interruption record no longer exists.", "error")
        return redirect(url_for("records_history"))

    interruption = serialize_interruption_row(row)
    deleted = delete_interruption_record(interruption_id)
    if not deleted:
        flash("The interruption record could not be deleted.", "error")
        return redirect(url_for("records_history"))

    log_audit_event(
        "delete_interruption",
        details={
            "interruption_id": interruption["id"],
            "name": interruption["name"],
            "target_name": interruption["targetName"],
            "source": "records_history",
        },
    )
    flash(f"Deleted saved interruption '{interruption['name']}'.", "success")
    return redirect(url_for("records_history"))


@app.route("/admin/users", methods=["GET"])
@role_required("can_manage_users")
def admin_users():
    users = list_users(app.config["AUTH_DB_PATH"])
    return render_template("admin_users.html", users=users)


@app.route("/admin/users/create", methods=["POST"])
@role_required("can_manage_users")
def admin_users_create():
    username = str(request.form.get("username") or "").strip()
    password = str(request.form.get("password") or "")
    confirm_password = str(request.form.get("confirm_password") or "")
    role = str(request.form.get("role") or "viewer").strip().lower()

    if password != confirm_password:
        return _admin_response("", "Password confirmation does not match.", 400)

    try:
        create_user(app.config["AUTH_DB_PATH"], username=username, password=password, role=role)
        log_audit_event(
            "create_user",
            details={
                "target_username": username,
                "role": role,
            },
        )
        return _admin_response(f"User '{username}' created successfully.")
    except Exception as exc:
        return _admin_response("", str(exc), 400)


@app.route("/admin/users/<int:user_id>/role", methods=["POST"])
@role_required("can_manage_users")
def admin_users_update_role(user_id):
    role = str(request.form.get("role") or "").strip().lower()
    try:
        updated_user = update_user_role(app.config["AUTH_DB_PATH"], user_id=user_id, new_role=role)
        log_audit_event(
            "update_role",
            details={
                "target_username": updated_user["username"],
                "new_role": updated_user["role"],
            },
        )
        return _admin_response(f"Updated role for '{updated_user['username']}' to {updated_user['role']}.")
    except Exception as exc:
        return _admin_response("", str(exc), 400)


@app.route("/admin/users/<int:user_id>/reset-password", methods=["POST"])
@role_required("can_manage_users")
def admin_users_reset_password(user_id):
    password = str(request.form.get("password") or "")
    confirm_password = str(request.form.get("confirm_password") or "")
    if password != confirm_password:
        return _admin_response("", "Password confirmation does not match.", 400)

    try:
        user = reset_user_password(app.config["AUTH_DB_PATH"], user_id=user_id, new_password=password)
        log_audit_event(
            "reset_password",
            details={
                "target_username": user["username"],
            },
        )
        return _admin_response(f"Password reset for '{user['username']}' completed.")
    except Exception as exc:
        return _admin_response("", str(exc), 400)


@app.route("/admin/users/<int:user_id>/delete", methods=["POST"])
@role_required("can_manage_users")
def admin_users_delete(user_id):
    try:
        user = get_user_by_id(app.config["AUTH_DB_PATH"], user_id)
        username = user["username"] if user else "user"
        delete_user(app.config["AUTH_DB_PATH"], user_id=user_id, acting_user_id=g.current_user["id"] if g.current_user else None)
        log_audit_event(
            "delete_user",
            details={
                "target_username": username,
                "target_role": user["role"] if user else "",
            },
        )
        return _admin_response(f"Deleted user '{username}'.")
    except Exception as exc:
        return _admin_response("", str(exc), 400)


@app.route("/upload", methods=["POST"])
@role_required("can_upload")
def upload():
    global LATEST_NETWORK_TOWERS
    if "file" not in request.files:
        validation = make_validation()
        validation["errors"].append("No feeder file uploaded.")
        return _upload_error("No feeder file uploaded.", validation)

    uploaded_file = request.files["file"]
    log_upload_outcome("feeder_upload", uploaded_file, "attempt", "Feeder upload received.")
    is_valid, error_response = validate_upload_file(
        uploaded_file,
        file_kind="feeder",
        max_size_bytes=app.config["MAX_FEEDER_UPLOAD_BYTES"],
    )
    if not is_valid:
        debug_upload_event("/upload", uploaded_file, "rejected", "minimal upload validation failed")
        log_upload_outcome("feeder_upload", uploaded_file, "failure", "Minimal feeder upload validation failed.")
        return error_response

    try:
        parsed = parse_uploaded_file(uploaded_file)
        points = parsed.get("points", [])
        route_edges = parsed.get("route_edges", [])
        parse_validation = parsed.get("validation", {})
        manual_overrides_raw = request.form.get("manual_overrides", "").strip()
        manual_overrides = {}
        if manual_overrides_raw:
            try:
                manual_overrides = json.loads(manual_overrides_raw)
            except Exception as exc:
                return jsonify({
                    "success": False,
                    "message": f"Invalid manual overrides JSON: {exc}",
                }), 400

        if len(points) < 2:
            validation = merge_validations(parse_validation)
            return jsonify({
                "success": False,
                "message": "The file was read, but less than 2 usable points were found.",
                "validation": validation,
            }), 400

        network = build_network_from_points(
            points,
            route_edges=route_edges,
            manual_overrides=manual_overrides,
            source_identifiers=app.config.get("SOURCE_IDENTIFIERS"),
            source_coordinates=app.config.get("SOURCE_COORDINATES"),
        )
        validation = merge_validations(parse_validation, network.get("validation", {}))
        network["validation"] = validation
        network["is_inferred"] = validation.get("summary", {}).get("inferred_edges", 0) > 0
        LATEST_NETWORK_TOWERS = list(network.get("towers", []))
        upsert_user_workspace(
            g.current_user["id"] if g.current_user else None,
            feederFileName=uploaded_file.filename,
            network=network,
            feederValidation=validation,
        )
        log_audit_event(
            "feeder_upload_success",
            details={
                "filename": uploaded_file.filename,
                "total_towers": len(network.get("towers", [])),
                "total_lines": len(network.get("lines", [])),
                "validation_status": validation.get("status", "ok"),
            },
        )

        return jsonify({
            "success": True,
            "message": f"Loaded {len(points)} tower points successfully.",
            "network": network,
            "validation": validation,
            "is_inferred": bool(network.get("is_inferred")),
        })

    except ValidationError as exc:
        LATEST_NETWORK_TOWERS = []
        debug_upload_event("/upload", uploaded_file, "failed", f"feeder parser failed: {exc}")
        message = build_upload_failure_message("feeder", f"Feeder parser failed: {exc}")
        log_upload_outcome("feeder_upload", uploaded_file, "failure", message)
        return _upload_error(message, exc.validation)
    except Exception as exc:
        LATEST_NETWORK_TOWERS = []
        validation = make_validation()
        validation["errors"].append(str(exc))
        debug_upload_event("/upload", uploaded_file, "failed", f"feeder parser failed: {exc}")
        message = build_upload_failure_message("feeder", f"Feeder parser failed: {exc}")
        log_upload_outcome("feeder_upload", uploaded_file, "failure", message)
        return _upload_error(message, validation)


@app.route("/upload_xlsx", methods=["POST"])
@role_required("can_upload")
def upload_xlsx():
    if "file" not in request.files:
        validation = make_validation()
        validation["errors"].append("No XLSX file uploaded.")
        return _upload_error("No XLSX file uploaded.", validation)

    uploaded_file = request.files["file"]
    log_upload_outcome("xlsx_upload", uploaded_file, "attempt", "XLSX upload received.")
    is_valid, error_response = validate_upload_file(
        uploaded_file,
        file_kind="XLSX",
        max_size_bytes=app.config["MAX_XLSX_UPLOAD_BYTES"],
    )
    if not is_valid:
        debug_upload_event("/upload_xlsx", uploaded_file, "rejected", "minimal upload validation failed")
        log_upload_outcome("xlsx_upload", uploaded_file, "failure", "Minimal XLSX upload validation failed.")
        return error_response

    parse_started = time.perf_counter()
    try:
        tower_names = json.loads(request.form.get("tower_names", "[]"))
        mapping_data = parse_xlsx_account_file(uploaded_file, tower_names=tower_names)
        parse_ms = round((time.perf_counter() - parse_started) * 1000, 2)
        cache_started = time.perf_counter()
        upsert_user_workspace(
            g.current_user["id"] if g.current_user else None,
            accountData=mapping_data,
            xlsxValidation=mapping_data.get("validation", {}),
        )
        cache_ms = round((time.perf_counter() - cache_started) * 1000, 2)
        compact_response = {
            "headers": list(mapping_data.get("headers", [])),
            "row_count": int(mapping_data.get("row_count", 0) or 0),
            "validation": mapping_data.get("validation", {}),
            "timings": mapping_data.get("timings", {}),
            "records": [],
            "serverBacked": True,
        }
        log_audit_event(
            "xlsx_upload_success",
            details={
                "filename": uploaded_file.filename,
                "row_count": mapping_data.get("row_count", 0),
                "validation_status": mapping_data.get("validation", {}).get("status", "ok"),
                "parse_ms": parse_ms,
                "cache_save_ms": cache_ms,
                "workbook_open_ms": mapping_data.get("timings", {}).get("workbook_open_ms", 0),
                "header_detection_ms": mapping_data.get("timings", {}).get("header_detection_ms", 0),
                "row_processing_ms": mapping_data.get("timings", {}).get("row_processing_ms", 0),
            },
        )
        if app.config.get("DEBUG", False):
            print(
                f"[upload-debug] route=/upload_xlsx status=success filename={uploaded_file.filename!r} "
                f"parse_ms={parse_ms} workbook_open_ms={mapping_data.get('timings', {}).get('workbook_open_ms', 0)} "
                f"header_detection_ms={mapping_data.get('timings', {}).get('header_detection_ms', 0)} "
                f"row_processing_ms={mapping_data.get('timings', {}).get('row_processing_ms', 0)} "
                f"cache_save_ms={cache_ms}"
            )

        return jsonify({
            "success": True,
            "message": f"Loaded {mapping_data['row_count']} XLSX rows successfully.",
            "account_data": compact_response,
            "validation": mapping_data.get("validation", {}),
        })

    except ValidationError as exc:
        debug_upload_event("/upload_xlsx", uploaded_file, "failed", f"xlsx parser failed: {exc}")
        message = build_upload_failure_message("xlsx", f"XLSX parser failed: {exc}")
        log_upload_outcome("xlsx_upload", uploaded_file, "failure", message)
        return _upload_error(message, exc.validation)
    except Exception as exc:
        validation = make_validation()
        validation["errors"].append(str(exc))
        debug_upload_event("/upload_xlsx", uploaded_file, "failed", f"xlsx parser failed: {exc}")
        if app.config.get("DEBUG", False):
            print(f"[upload-debug] route=/upload_xlsx status=failed filename={uploaded_file.filename!r} message={exc}")
        message = build_upload_failure_message("xlsx", f"XLSX parser failed: {exc}")
        log_upload_outcome("xlsx_upload", uploaded_file, "failure", message)
        return _upload_error(message, validation)


@app.route("/upload_kml", methods=["POST"])
@role_required("can_upload")
def upload_kml():
    if "file" not in request.files:
        validation = make_validation()
        validation["errors"].append("No KML file uploaded.")
        return _upload_error("No KML file uploaded.", validation)

    uploaded_file = request.files["file"]
    log_upload_outcome("kml_upload", uploaded_file, "attempt", "KML upload received.")
    is_valid, error_response = validate_upload_file(
        uploaded_file,
        file_kind="KML",
        max_size_bytes=app.config["MAX_KML_UPLOAD_BYTES"],
    )
    if not is_valid:
        debug_upload_event("/upload_kml", uploaded_file, "rejected", "minimal upload validation failed")
        log_upload_outcome("kml_upload", uploaded_file, "failure", "Minimal KML upload validation failed.")
        return error_response

    try:
        tower_names = json.loads(request.form.get("tower_names", "[]"))
        tower_points = json.loads(request.form.get("tower_points", "[]"))
        overlay_data = parse_kml_overlay_file(uploaded_file, tower_names=tower_names, tower_points=tower_points)
        upsert_user_workspace(
            g.current_user["id"] if g.current_user else None,
            kmlOverlay=overlay_data,
            kmlValidation=overlay_data.get("validation", {}),
        )
        log_audit_event(
            "kml_upload_success",
            details={
                "filename": uploaded_file.filename,
                "feature_count": overlay_data.get("feature_count", 0),
                "validation_status": overlay_data.get("validation", {}).get("status", "ok"),
            },
        )
        return jsonify({
            "success": True,
            "message": f"Loaded {overlay_data['feature_count']} KML features successfully.",
            "overlay": overlay_data,
            "validation": overlay_data.get("validation", {}),
        })
    except ValidationError as exc:
        debug_upload_event("/upload_kml", uploaded_file, "failed", f"kml parser failed: {exc}")
        message = build_upload_failure_message("kml", f"KML parser failed: {exc}")
        log_upload_outcome("kml_upload", uploaded_file, "failure", message)
        return _upload_error(message, exc.validation)
    except Exception as exc:
        validation = make_validation()
        validation["errors"].append(str(exc))
        debug_upload_event("/upload_kml", uploaded_file, "failed", f"kml parser failed: {exc}")
        message = build_upload_failure_message("kml", f"KML parser failed: {exc}")
        log_upload_outcome("kml_upload", uploaded_file, "failure", message)
        return _upload_error(message, validation)


@app.route("/export_interruption", methods=["POST"])
@role_required("can_export")
def export_interruption():
    payload = request.get_json(silent=True) or {}

    try:
        payload["user"] = g.current_user["username"] if g.current_user else ""
        interruption = create_interruption_payload(payload)
        log_audit_event(
            "export_interruption",
            details={
                "name": interruption.get("name", ""),
                "target_name": interruption.get("target_name", ""),
                "feeder_name": interruption.get("feeder_name", ""),
                "trace_confidence": interruption.get("trace_confidence", ""),
            },
        )
        workbook_stream = build_interruption_workbook(interruption)
        safe_name = interruption["name"].replace(" ", "_")
        start_date = interruption.get("start_date", "")
        start_time = interruption.get("start_time", "").replace(":", "-")
        end_date = interruption.get("end_date", "")
        end_time = interruption.get("end_time", "").replace(":", "-")
        filename = f"{safe_name}_{start_date}_{start_time}_to_{end_date}_{end_time}.xlsx"

        return send_file(
            workbook_stream,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as exc:
        return api_error(str(exc))


@app.route("/export_disconnected_fragments", methods=["POST"])
@role_required("can_export")
def export_disconnected_fragments():
    payload = request.get_json(silent=True) or {}
    disconnected_fragments = list(payload.get("disconnected_fragments") or [])
    feeder_name = str(payload.get("feeder_name") or "").strip()
    tower_data = list(payload.get("towers") or LATEST_NETWORK_TOWERS or [])

    if not disconnected_fragments:
        return jsonify({
            "success": False,
            "message": "There are no disconnected fragments to export.",
        }), 400

    try:
        log_audit_event(
            "export_disconnected_fragments",
            details={
                "feeder_name": feeder_name,
                "fragment_count": len(disconnected_fragments),
            },
        )
        workbook_stream = build_disconnected_fragments_workbook(disconnected_fragments, towers=tower_data)
        safe_feeder_name = (feeder_name or "disconnected_fragments").replace(" ", "_")
        safe_feeder_name = safe_feeder_name.rsplit(".", 1)[0]
        filename = f"{safe_feeder_name}_disconnected_fragments.xlsx"

        return send_file(
            workbook_stream,
            as_attachment=True,
            download_name=filename,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as exc:
        return api_error(str(exc))


@app.cli.command("seed-admin")
@click.option("--username", default="admin", help="Admin username to create if missing.")
@click.option("--password", default="Admin@12345", help="Admin password to set for the seeded account.")
def seed_admin_command(username, password):
    init_auth_db(app.config["AUTH_DB_PATH"])
    seed_result = ensure_seed_admin(app.config["AUTH_DB_PATH"], username=username, password=password)
    if seed_result["created"]:
        click.echo(f"Created admin account '{seed_result['username']}'.")
    else:
        click.echo(f"Admin account '{seed_result['username']}' already exists.")

@app.cli.command("backup-db")
def backup_db_command():
    backup_path = create_timestamped_backup(app.config["AUTH_DB_PATH"], app.config["BACKUP_DIR"])
    click.echo(f"Database backup created: {backup_path}")
    click.echo(
        "Note: backup-db stores the SQLite database only. "
        "If you also want live per-user workspace restore state, copy "
        f"'{app.config['WORKSPACE_CACHE_DIR']}' separately."
    )


create_app()


if __name__ == "__main__":
    create_app().run(debug=bool(app.config.get("DEBUG", False)))
