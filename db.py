import os
import shutil
import sqlite3
from contextlib import contextmanager
from datetime import datetime


class DatabaseBusyError(RuntimeError):
    pass


def _env_int(name, default):
    value = os.environ.get(name)
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


DEFAULT_SQLITE_WAL_AUTOCHECKPOINT_PAGES = _env_int("OUTAGE_SQLITE_WAL_AUTOCHECKPOINT_PAGES", 1000)
DEFAULT_SQLITE_JOURNAL_SIZE_LIMIT_BYTES = _env_int(
    "OUTAGE_SQLITE_JOURNAL_SIZE_LIMIT_BYTES",
    64 * 1024 * 1024,
)


def is_database_locked_error(error):
    message = str(error or "").lower()
    return "database is locked" in message or "database table is locked" in message


def get_friendly_database_error_message():
    return "The outage database is busy right now. Please wait a few seconds and try again."


def configure_sqlite_connection(connection, busy_timeout_ms=10000):
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
    connection.execute(f"PRAGMA wal_autocheckpoint={int(DEFAULT_SQLITE_WAL_AUTOCHECKPOINT_PAGES)}")
    connection.execute(f"PRAGMA journal_size_limit={int(DEFAULT_SQLITE_JOURNAL_SIZE_LIMIT_BYTES)}")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def get_db_connection(db_path, *, busy_timeout_ms=10000):
    connection = sqlite3.connect(
        db_path,
        timeout=max(float(busy_timeout_ms) / 1000.0, 1.0),
        check_same_thread=False,
    )
    return configure_sqlite_connection(connection, busy_timeout_ms=busy_timeout_ms)


@contextmanager
def managed_db(db_path, *, busy_timeout_ms=10000):
    connection = get_db_connection(db_path, busy_timeout_ms=busy_timeout_ms)
    try:
        yield connection
        connection.commit()
    except sqlite3.OperationalError as exc:
        connection.rollback()
        if is_database_locked_error(exc):
            raise DatabaseBusyError(get_friendly_database_error_message()) from exc
        raise
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


@contextmanager
def managed_db_readonly(db_path, *, busy_timeout_ms=10000):
    connection = get_db_connection(db_path, busy_timeout_ms=busy_timeout_ms)
    try:
        yield connection
    except sqlite3.OperationalError as exc:
        if is_database_locked_error(exc):
            raise DatabaseBusyError(get_friendly_database_error_message()) from exc
        raise
    finally:
        connection.close()


def ensure_parent_directory(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)


def create_timestamped_backup(db_path, backup_dir):
    ensure_parent_directory(os.path.join(backup_dir, "placeholder"))
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    base_name = os.path.splitext(os.path.basename(db_path))[0] or "outage_management"
    backup_path = os.path.join(backup_dir, f"{base_name}_{timestamp}.sqlite3")

    source_connection = sqlite3.connect(db_path, timeout=10.0, check_same_thread=False)
    backup_connection = sqlite3.connect(backup_path)
    try:
        source_connection.backup(backup_connection)
    finally:
        backup_connection.close()
        source_connection.close()

    checkpoint_wal(db_path, mode="TRUNCATE")
    return backup_path


def get_wal_path(db_path):
    return f"{db_path}-wal"


def get_file_size(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return 0


def checkpoint_wal(db_path, *, busy_timeout_ms=10000, mode="PASSIVE"):
    normalized_mode = str(mode or "PASSIVE").strip().upper()
    if normalized_mode not in {"PASSIVE", "FULL", "RESTART", "TRUNCATE"}:
        normalized_mode = "PASSIVE"
    connection = get_db_connection(db_path, busy_timeout_ms=busy_timeout_ms)
    try:
        row = connection.execute(f"PRAGMA wal_checkpoint({normalized_mode})").fetchone()
        connection.execute("PRAGMA optimize")
    except sqlite3.OperationalError as exc:
        if is_database_locked_error(exc):
            raise DatabaseBusyError(get_friendly_database_error_message()) from exc
        raise
    finally:
        connection.close()
    result = {
        "mode": normalized_mode,
        "busy": 0,
        "log_frames": 0,
        "checkpointed_frames": 0,
        "wal_size_bytes": get_file_size(get_wal_path(db_path)),
    }
    if row is not None and len(row) >= 3:
        result["busy"] = int(row[0] or 0)
        result["log_frames"] = int(row[1] or 0)
        result["checkpointed_frames"] = int(row[2] or 0)
    return result


def maintain_wal(db_path, *, busy_timeout_ms=10000, checkpoint_threshold_bytes=32 * 1024 * 1024, force=False):
    wal_path = get_wal_path(db_path)
    wal_size = get_file_size(wal_path)
    if not force and wal_size < int(checkpoint_threshold_bytes or 0):
        return {
            "performed": False,
            "wal_size_bytes": wal_size,
        }

    mode = "TRUNCATE" if force or wal_size >= int(checkpoint_threshold_bytes or 0) * 2 else "PASSIVE"
    result = checkpoint_wal(db_path, busy_timeout_ms=busy_timeout_ms, mode=mode)
    result["performed"] = True
    return result


def vacuum_database(db_path, *, busy_timeout_ms=10000):
    connection = get_db_connection(db_path, busy_timeout_ms=busy_timeout_ms)
    try:
        connection.isolation_level = None
        connection.execute("VACUUM")
    except sqlite3.OperationalError as exc:
        if is_database_locked_error(exc):
            raise DatabaseBusyError(get_friendly_database_error_message()) from exc
        raise
    finally:
        connection.close()
    return {"performed": True}


def list_backup_files(backup_dir, limit=10):
    if not os.path.isdir(backup_dir):
        return []
    records = []
    for name in os.listdir(backup_dir):
        path = os.path.join(backup_dir, name)
        if not os.path.isfile(path):
            continue
        stats = os.stat(path)
        records.append({
            "name": name,
            "path": path,
            "size_bytes": stats.st_size,
            "modified_at": datetime.fromtimestamp(stats.st_mtime),
        })
    records.sort(key=lambda item: item["modified_at"], reverse=True)
    return records[:limit]
