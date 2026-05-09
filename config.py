import os
from datetime import timedelta


def _env_text(name, default=""):
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip()


def _env_bool(name, default=False):
    value = os.environ.get(name)
    if value is None:
        return default
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    value = os.environ.get(name)
    if value is None or str(value).strip() == "":
        return default
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return default


def _env_csv(name, default_items):
    value = _env_text(name)
    if not value:
        return list(default_items)
    return [item.strip() for item in value.split(",") if item.strip()]


def _env_coordinates(name, default_value):
    raw_value = _env_text(name)
    if not raw_value:
        return default_value
    parts = [part.strip() for part in raw_value.split(",")]
    if len(parts) != 2:
        return default_value
    try:
        return (float(parts[0]), float(parts[1]))
    except (TypeError, ValueError):
        return default_value


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DEFAULT_SOURCE_IDENTIFIERS = ["DCC7", "DCC", "TAL0001"]
DEFAULT_SOURCE_COORDINATES = (15.59822, 120.92152)
DEVELOPMENT_FALLBACK_SECRET = "outage-management-dev-secret-change-me"


class BaseConfig:
    OUTAGE_ENV = _env_text("OUTAGE_ENV", _env_text("FLASK_ENV", "development")).lower() or "development"
    IS_DEVELOPMENT = OUTAGE_ENV in {"development", "dev", "local"}

    SECRET_KEY = _env_text("OUTAGE_SECRET_KEY")
    SECRET_KEY_MIN_LENGTH = _env_int("OUTAGE_SECRET_KEY_MIN_LENGTH", 32)
    AUTH_DB_PATH = _env_text("OUTAGE_DB_PATH", os.path.join(BASE_DIR, "users.db"))
    BACKUP_DIR = _env_text("OUTAGE_BACKUP_DIR", os.path.join(BASE_DIR, "backups"))
    WORKSPACE_CACHE_DIR = _env_text("OUTAGE_WORKSPACE_CACHE_DIR", os.path.join(BASE_DIR, "workspace_cache"))
    SQLITE_BUSY_TIMEOUT_MS = _env_int("OUTAGE_SQLITE_BUSY_TIMEOUT_MS", 10000)
    SQLITE_WAL_CHECKPOINT_BYTES = _env_int("OUTAGE_SQLITE_WAL_CHECKPOINT_BYTES", 32 * 1024 * 1024)
    SQLITE_WAL_MAINTENANCE_INTERVAL_SECONDS = _env_int("OUTAGE_SQLITE_WAL_MAINTENANCE_INTERVAL_SECONDS", 180)
    SQLITE_WAL_AUTOCHECKPOINT_PAGES = _env_int("OUTAGE_SQLITE_WAL_AUTOCHECKPOINT_PAGES", 1000)
    SQLITE_JOURNAL_SIZE_LIMIT_BYTES = _env_int("OUTAGE_SQLITE_JOURNAL_SIZE_LIMIT_BYTES", 64 * 1024 * 1024)
    AUDIT_LOG_PRUNE_INTERVAL_SECONDS = _env_int("OUTAGE_AUDIT_LOG_PRUNE_INTERVAL_SECONDS", 120)
    AUDIT_LOG_RETENTION_DAYS = _env_int("OUTAGE_AUDIT_LOG_RETENTION_DAYS", 90)
    AUDIT_LOG_MAX_ROWS = _env_int("OUTAGE_AUDIT_LOG_MAX_ROWS", 10000)
    AUDIT_LOG_PRUNE_BATCH_ROWS = _env_int("OUTAGE_AUDIT_LOG_PRUNE_BATCH_ROWS", 1000)

    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _env_bool("OUTAGE_SESSION_COOKIE_SECURE", not IS_DEVELOPMENT)
    SESSION_COOKIE_NAME = _env_text("OUTAGE_SESSION_COOKIE_NAME", "outage_session")
    SESSION_REFRESH_EACH_REQUEST = True
    PREFERRED_URL_SCHEME = _env_text("OUTAGE_PREFERRED_URL_SCHEME", "http" if IS_DEVELOPMENT else "https")
    USE_PROXY_FIX = _env_bool("OUTAGE_USE_PROXY_FIX", False)
    PROXY_FIX_X_FOR = _env_int("OUTAGE_PROXY_FIX_X_FOR", 1)
    PROXY_FIX_X_PROTO = _env_int("OUTAGE_PROXY_FIX_X_PROTO", 1)
    PROXY_FIX_X_HOST = _env_int("OUTAGE_PROXY_FIX_X_HOST", 1)

    AUTO_SEED_ADMIN = _env_bool("OUTAGE_AUTO_SEED_ADMIN", IS_DEVELOPMENT)
    SHOW_SEEDED_ADMIN_CREDENTIALS = _env_bool("OUTAGE_SHOW_SEED_CREDENTIALS", IS_DEVELOPMENT)
    SEED_ADMIN_USERNAME = _env_text("OUTAGE_SEED_ADMIN_USERNAME", "admin")
    SEED_ADMIN_PASSWORD = _env_text("OUTAGE_SEED_ADMIN_PASSWORD", "Admin@12345")

    MAX_CONTENT_LENGTH = _env_int("OUTAGE_MAX_UPLOAD_BYTES", 30 * 1024 * 1024)
    MAX_FEEDER_UPLOAD_BYTES = _env_int("OUTAGE_MAX_FEEDER_UPLOAD_BYTES", 5 * 1024 * 1024)
    MAX_XLSX_UPLOAD_BYTES = _env_int("OUTAGE_MAX_XLSX_UPLOAD_BYTES", 20 * 1024 * 1024)
    MAX_KML_UPLOAD_BYTES = _env_int("OUTAGE_MAX_KML_UPLOAD_BYTES", 20 * 1024 * 1024)
    WORKSPACE_LAZY_RESTORE_BYTES = _env_int("OUTAGE_WORKSPACE_LAZY_RESTORE_BYTES", 1 * 1024 * 1024)

    DEBUG = _env_bool("OUTAGE_DEBUG", IS_DEVELOPMENT)
    TESTING = False

    SOURCE_IDENTIFIERS = _env_csv("OUTAGE_SOURCE_IDENTIFIERS", DEFAULT_SOURCE_IDENTIFIERS)
    SOURCE_COORDINATES = _env_coordinates("OUTAGE_SOURCE_COORDINATES", DEFAULT_SOURCE_COORDINATES)


class DevelopmentConfig(BaseConfig):
    if not BaseConfig.SECRET_KEY:
        SECRET_KEY = DEVELOPMENT_FALLBACK_SECRET


class ProductionConfig(BaseConfig):
    DEBUG = _env_bool("OUTAGE_DEBUG", False)
    SHOW_SEEDED_ADMIN_CREDENTIALS = _env_bool("OUTAGE_SHOW_SEED_CREDENTIALS", False)
    AUTO_SEED_ADMIN = _env_bool("OUTAGE_AUTO_SEED_ADMIN", False)
    SESSION_COOKIE_SECURE = _env_bool("OUTAGE_SESSION_COOKIE_SECURE", True)


def get_config_class():
    env_name = _env_text("OUTAGE_ENV", _env_text("FLASK_ENV", "development")).lower() or "development"
    if env_name in {"production", "prod"}:
        return ProductionConfig
    return DevelopmentConfig


def validate_config(config):
    secret_key = str(config.get("SECRET_KEY") or "").strip()
    if not secret_key:
        if config.get("IS_DEVELOPMENT"):
            config["SECRET_KEY"] = DEVELOPMENT_FALLBACK_SECRET
            return
        raise RuntimeError("OUTAGE_SECRET_KEY must be set in non-development environments.")

    if config.get("IS_DEVELOPMENT"):
        return

    minimum_length = int(config.get("SECRET_KEY_MIN_LENGTH", 32) or 32)
    if secret_key == DEVELOPMENT_FALLBACK_SECRET:
        raise RuntimeError("Production cannot use the built-in development fallback secret. Set OUTAGE_SECRET_KEY.")
    if len(secret_key) < minimum_length:
        raise RuntimeError(f"OUTAGE_SECRET_KEY must be at least {minimum_length} characters in production.")
    if bool(config.get("DEBUG", False)):
        raise RuntimeError("OUTAGE_DEBUG must be disabled in production.")
    if bool(config.get("AUTO_SEED_ADMIN", False)):
        raise RuntimeError("OUTAGE_AUTO_SEED_ADMIN must be disabled in production.")
    if bool(config.get("SHOW_SEEDED_ADMIN_CREDENTIALS", False)):
        raise RuntimeError("OUTAGE_SHOW_SEED_CREDENTIALS must be disabled in production.")
    if not bool(config.get("SESSION_COOKIE_SECURE", False)):
        raise RuntimeError("OUTAGE_SESSION_COOKIE_SECURE must remain enabled in production.")
