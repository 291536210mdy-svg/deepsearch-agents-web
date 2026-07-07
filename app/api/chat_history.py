import json
import os
import uuid
from datetime import datetime
from typing import Any

from dotenv import find_dotenv, load_dotenv
from mysql.connector import connect


load_dotenv(find_dotenv())

DEFAULT_USER_ID = "default"
THREAD_TITLE_LIMIT = 60
_schema_ready = False


def get_db_config() -> dict[str, Any]:
    config = {
        "host": os.getenv("MYSQL_HOST", "localhost"),
        "port": int(os.getenv("MYSQL_PORT", "3306")),
        "user": os.getenv("MYSQL_USER"),
        "password": os.getenv("MYSQL_PASSWORD"),
        "database": os.getenv("MYSQL_DATABASE"),
        "charset": os.getenv("MYSQL_CHARSET", "utf8mb4"),
        "collation": os.getenv("MYSQL_COLLATION", "utf8mb4_unicode_ci"),
        "autocommit": True,
        "sql_mode": os.getenv("MYSQL_SQL_MODE", "TRADITIONAL"),
    }
    config = {key: value for key, value in config.items() if value is not None}
    missing = [key for key in ("user", "password", "database") if key not in config]
    if missing:
        raise ValueError(f"缺少数据库配置：{', '.join(missing)}")
    return config


def db_connect():
    return connect(**get_db_config())


def ensure_schema() -> None:
    global _schema_ready
    if _schema_ready:
        return

    with db_connect() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_threads (
                  id VARCHAR(64) PRIMARY KEY,
                  user_id VARCHAR(64) NOT NULL DEFAULT 'default',
                  title VARCHAR(255) NULL,
                  status ENUM('regular', 'archived', 'deleted') NOT NULL DEFAULT 'regular',
                  session_path TEXT NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                  last_message_at DATETIME NULL,
                  metadata JSON NULL,
                  INDEX idx_chat_threads_user_updated (user_id, status, updated_at, id)
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """
            )
            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS chat_messages (
                  id BIGINT AUTO_INCREMENT PRIMARY KEY,
                  thread_id VARCHAR(64) NOT NULL,
                  role ENUM('user', 'assistant', 'system', 'tool', 'event') NOT NULL,
                  content LONGTEXT NULL,
                  event_type VARCHAR(64) NULL,
                  event_json JSON NULL,
                  files_json JSON NULL,
                  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  INDEX idx_chat_messages_thread_created (thread_id, created_at, id),
                  CONSTRAINT fk_chat_messages_thread
                    FOREIGN KEY (thread_id) REFERENCES chat_threads(id)
                    ON DELETE CASCADE
                ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """
            )
    _schema_ready = True


def json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False)


def json_loads(value: Any) -> Any:
    if not value:
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return None


def iso_datetime(value: Any) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value) if value is not None else ""


def thread_title_from_query(query: str) -> str:
    text = " ".join(str(query or "").split())
    if not text:
        return "新对话"
    return text[:THREAD_TITLE_LIMIT]


def row_to_thread(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "user_id": row["user_id"],
        "title": row.get("title") or "新对话",
        "status": row["status"],
        "session_path": row.get("session_path") or "",
        "created_at": iso_datetime(row.get("created_at")),
        "updated_at": iso_datetime(row.get("updated_at")),
        "last_message_at": iso_datetime(row.get("last_message_at")),
        "metadata": json_loads(row.get("metadata")) or {},
    }


def row_to_message(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": int(row["id"]),
        "thread_id": row["thread_id"],
        "role": row["role"],
        "content": row.get("content") or "",
        "event_type": row.get("event_type") or "",
        "event_json": json_loads(row.get("event_json")),
        "files_json": json_loads(row.get("files_json")),
        "created_at": iso_datetime(row.get("created_at")),
    }


def create_thread(
    *,
    thread_id: str | None = None,
    title: str | None = None,
    session_path: str | None = None,
    user_id: str = DEFAULT_USER_ID,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ensure_schema()
    thread_id = thread_id or str(uuid.uuid4())
    with db_connect() as conn:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                """
                INSERT INTO chat_threads (id, user_id, title, session_path, metadata)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                  title = IF(title IS NULL OR title = '' OR title = '新对话', VALUES(title), title),
                  session_path = COALESCE(VALUES(session_path), session_path),
                  metadata = COALESCE(VALUES(metadata), metadata),
                  status = IF(status = 'deleted', 'regular', status),
                  updated_at = CURRENT_TIMESTAMP
                """,
                (
                    thread_id,
                    user_id,
                    title or "新对话",
                    session_path,
                    json_dumps(metadata or {}),
                ),
            )
            cursor.execute("SELECT * FROM chat_threads WHERE id = %s", (thread_id,))
            return row_to_thread(cursor.fetchone())


def ensure_chat_thread(
    thread_id: str,
    *,
    title: str | None = None,
    session_path: str | None = None,
    user_id: str = DEFAULT_USER_ID,
) -> dict[str, Any]:
    return create_thread(
        thread_id=thread_id,
        title=title,
        session_path=session_path,
        user_id=user_id,
    )


def list_threads(
    *,
    limit: int = 20,
    before: str | None = None,
    user_id: str = DEFAULT_USER_ID,
    status: str = "regular",
) -> dict[str, Any]:
    ensure_schema()
    limit = max(1, min(int(limit or 20), 100))
    params: list[Any] = [user_id, status]
    cursor_clause = ""

    if before:
        with db_connect() as conn:
            with conn.cursor(dictionary=True) as cursor:
                cursor.execute("SELECT updated_at, id FROM chat_threads WHERE id = %s", (before,))
                cursor_row = cursor.fetchone()
        if cursor_row:
            cursor_clause = "AND (updated_at < %s OR (updated_at = %s AND id < %s))"
            params.extend([cursor_row["updated_at"], cursor_row["updated_at"], before])

    params.append(limit + 1)
    with db_connect() as conn:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                f"""
                SELECT * FROM chat_threads
                WHERE user_id = %s AND status = %s {cursor_clause}
                ORDER BY updated_at DESC, id DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()

    has_more = len(rows) > limit
    items = [row_to_thread(row) for row in rows[:limit]]
    return {
        "items": items,
        "has_more": has_more,
        "next_before": items[-1]["id"] if has_more and items else None,
    }


def get_thread(thread_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with db_connect() as conn:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                "SELECT * FROM chat_threads WHERE id = %s AND status <> 'deleted'",
                (thread_id,),
            )
            row = cursor.fetchone()
    return row_to_thread(row) if row else None


def update_thread(
    thread_id: str,
    *,
    title: str | None = None,
    status: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    ensure_schema()
    updates = []
    params: list[Any] = []
    if title is not None:
        updates.append("title = %s")
        params.append(title)
    if status is not None:
        updates.append("status = %s")
        params.append(status)
    if metadata is not None:
        updates.append("metadata = %s")
        params.append(json_dumps(metadata))
    if not updates:
        return get_thread(thread_id)

    params.append(thread_id)
    with db_connect() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                f"UPDATE chat_threads SET {', '.join(updates)} WHERE id = %s",
                tuple(params),
            )
    return get_thread(thread_id)


def soft_delete_thread(thread_id: str) -> bool:
    ensure_schema()
    with db_connect() as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "UPDATE chat_threads SET status = 'deleted' WHERE id = %s",
                (thread_id,),
            )
            return cursor.rowcount > 0


def append_message(
    thread_id: str,
    role: str,
    content: str | None = None,
    *,
    event_type: str | None = None,
    event_json: dict[str, Any] | None = None,
    files_json: Any = None,
) -> dict[str, Any]:
    ensure_schema()
    with db_connect() as conn:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                """
                INSERT INTO chat_messages
                  (thread_id, role, content, event_type, event_json, files_json)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    thread_id,
                    role,
                    content,
                    event_type,
                    json_dumps(event_json),
                    json_dumps(files_json),
                ),
            )
            message_id = cursor.lastrowid
            cursor.execute(
                """
                UPDATE chat_threads
                SET last_message_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
                """,
                (thread_id,),
            )
            cursor.execute("SELECT * FROM chat_messages WHERE id = %s", (message_id,))
            return row_to_message(cursor.fetchone())


def list_messages(thread_id: str, *, limit: int = 200) -> list[dict[str, Any]]:
    ensure_schema()
    limit = max(1, min(int(limit or 200), 500))
    with db_connect() as conn:
        with conn.cursor(dictionary=True) as cursor:
            cursor.execute(
                """
                SELECT * FROM chat_messages
                WHERE thread_id = %s
                ORDER BY created_at ASC, id ASC
                LIMIT %s
                """,
                (thread_id, limit),
            )
            return [row_to_message(row) for row in cursor.fetchall()]
