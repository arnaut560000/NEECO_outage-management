import secrets
from functools import wraps
from flask import g, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash
from db import ensure_parent_directory, get_db_connection, managed_db

VALID_ROLES = ("admin", "supervisor", "operator", "viewer")
MIN_PASSWORD_LENGTH = 8
ROLE_PERMISSIONS = {
    "admin": {
        "can_upload": True,
        "can_validate": True,
        "can_export": True,
        "can_view_records": True,
        "can_delete_saved_records": True,
        "can_view_audit_logs": True,
        "can_manage_audit_logs": True,
        "can_edit_interruption": True,
        "can_manage_users": True,
        "read_only": False,
    },
    "supervisor": {
        "can_upload": True,
        "can_validate": True,
        "can_export": True,
        "can_view_records": True,
        "can_delete_saved_records": True,
        "can_view_audit_logs": True,
        "can_manage_audit_logs": False,
        "can_edit_interruption": True,
        "can_manage_users": False,
        "read_only": False,
    },
    "operator": {
        "can_upload": True,
        "can_validate": True,
        "can_export": True,
        "can_view_records": False,
        "can_delete_saved_records": False,
        "can_view_audit_logs": False,
        "can_manage_audit_logs": False,
        "can_edit_interruption": True,
        "can_manage_users": False,
        "read_only": False,
    },
    "viewer": {
        "can_upload": False,
        "can_validate": True,
        "can_export": False,
        "can_view_records": True,
        "can_delete_saved_records": False,
        "can_view_audit_logs": False,
        "can_manage_audit_logs": False,
        "can_edit_interruption": False,
        "can_manage_users": False,
        "read_only": True,
    },
}
def init_auth_db(db_path):
    ensure_parent_directory(db_path)
    with managed_db(db_path) as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )


def _normalize_username(username):
    return str(username or "").strip()


def _validate_username(username):
    normalized_username = _normalize_username(username)
    if not normalized_username:
        raise ValueError("Username is required.")
    return normalized_username


def _validate_password(password):
    password_text = str(password or "")
    if len(password_text) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters long.")
    return password_text


def _validate_role(role):
    normalized_role = str(role or "viewer").strip().lower()
    if normalized_role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}")
    return normalized_role


def _read_one(db_path, query, params=()):
    connection = get_db_connection(db_path)
    try:
        return connection.execute(query, params).fetchone()
    finally:
        connection.close()


def _read_all(db_path, query, params=()):
    connection = get_db_connection(db_path)
    try:
        return connection.execute(query, params).fetchall()
    finally:
        connection.close()


def get_user_by_id(db_path, user_id):
    if not user_id:
        return None
    return _read_one(
        db_path,
        "SELECT id, username, password_hash, role, created_at FROM users WHERE id = ?",
        (user_id,),
    )


def get_user_by_username(db_path, username):
    normalized = _normalize_username(username).lower()
    if not normalized:
        return None
    return _read_one(
        db_path,
        "SELECT id, username, password_hash, role, created_at FROM users WHERE lower(username) = ?",
        (normalized,),
    )


def list_users(db_path):
    return _read_all(
        db_path,
        "SELECT id, username, role, created_at FROM users ORDER BY lower(username) ASC",
    )


def count_users_with_role(db_path, role):
    normalized_role = _validate_role(role)
    row = _read_one(
        db_path,
        "SELECT COUNT(*) AS total FROM users WHERE role = ?",
        (normalized_role,),
    )
    return int(row["total"] or 0)


def create_user(db_path, username, password, role):
    normalized_username = _validate_username(username)
    password_text = _validate_password(password)
    normalized_role = _validate_role(role)
    if get_user_by_username(db_path, normalized_username):
        raise ValueError("Username already exists.")

    password_hash = generate_password_hash(password_text)
    with managed_db(db_path) as connection:
        cursor = connection.execute(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            (normalized_username, password_hash, normalized_role),
        )
        user_id = cursor.lastrowid
    return get_user_by_id(db_path, user_id)


def update_user_role(db_path, user_id, new_role):
    user = get_user_by_id(db_path, user_id)
    if not user:
        raise ValueError("User not found.")

    normalized_role = _validate_role(new_role)
    if user["role"] == "admin" and normalized_role != "admin" and count_users_with_role(db_path, "admin") <= 1:
        raise ValueError("Cannot change the last remaining admin to a non-admin role.")

    with managed_db(db_path) as connection:
        connection.execute("UPDATE users SET role = ? WHERE id = ?", (normalized_role, user_id))
    return get_user_by_id(db_path, user_id)


def reset_user_password(db_path, user_id, new_password):
    user = get_user_by_id(db_path, user_id)
    if not user:
        raise ValueError("User not found.")

    password_text = _validate_password(new_password)
    password_hash = generate_password_hash(password_text)
    with managed_db(db_path) as connection:
        connection.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    return get_user_by_id(db_path, user_id)


def delete_user(db_path, user_id, acting_user_id=None):
    user = get_user_by_id(db_path, user_id)
    if not user:
        raise ValueError("User not found.")

    if acting_user_id and int(user_id) == int(acting_user_id):
        raise ValueError("You cannot delete your own logged-in admin account.")

    if user["role"] == "admin" and count_users_with_role(db_path, "admin") <= 1:
        raise ValueError("Cannot delete the last remaining admin account.")

    with managed_db(db_path) as connection:
        connection.execute("DELETE FROM users WHERE id = ?", (user_id,))


def ensure_seed_admin(db_path, username="admin", password="Admin@12345"):
    existing = get_user_by_username(db_path, username)
    if existing:
        return {"created": False, "username": existing["username"], "password": None}
    create_user(db_path, username=username, password=password, role="admin")
    return {"created": True, "username": username, "password": password}


def authenticate_user(db_path, username, password):
    user = get_user_by_username(db_path, username)
    if not user:
        return None
    if not check_password_hash(user["password_hash"], str(password or "")):
        return None
    return user


def serialize_user(user_row):
    if not user_row:
        return None
    return {
        "id": user_row["id"],
        "username": user_row["username"],
        "role": user_row["role"],
    }


def get_role_permissions(role):
    permissions = ROLE_PERMISSIONS.get(str(role or "viewer").strip().lower(), ROLE_PERMISSIONS["viewer"])
    return dict(permissions)


def get_or_create_csrf_token():
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


def validate_csrf_token(submitted_token):
    expected_token = str(session.get("_csrf_token") or "")
    provided_token = str(submitted_token or "")
    return bool(expected_token and provided_token and secrets.compare_digest(expected_token, provided_token))


def _wants_json_response():
    accept_header = request.headers.get("Accept", "")
    return (
        request.method != "GET"
        or request.is_json
        or request.path.startswith("/upload")
        or request.path.startswith("/export")
        or "application/json" in accept_header.lower()
    )


def _unauthorized_response(message, status_code=401):
    if _wants_json_response():
        return jsonify({"success": False, "message": message}), status_code
    if status_code == 401:
        return redirect(url_for("login", next=request.url))
    return render_template("error.html", error_title="Permission Denied", error_message=message), status_code


def login_required(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if not getattr(g, "current_user", None):
            return _unauthorized_response("Please log in to continue.", 401)
        return view_func(*args, **kwargs)

    return wrapped


def role_required(permission_name):
    def decorator(view_func):
        @wraps(view_func)
        def wrapped(*args, **kwargs):
            user = getattr(g, "current_user", None)
            if not user:
                return _unauthorized_response("Please log in to continue.", 401)
            permissions = get_role_permissions(user["role"])
            if not permissions.get(permission_name, False):
                return _unauthorized_response("You do not have permission to perform this action.", 403)
            return view_func(*args, **kwargs)

        return wrapped

    return decorator


def login_user(user_row):
    session.clear()
    session["user_id"] = user_row["id"]


def logout_user():
    session.clear()
