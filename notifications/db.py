"""Relaygent Notifications — database helpers."""

import contextlib
import os
import sqlite3

from config import DB_PATH


def get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS reminders (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trigger_time TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                fired INTEGER DEFAULT 0,
                recurrence TEXT DEFAULT NULL
            )
        """)
        with contextlib.suppress(sqlite3.OperationalError):
            conn.execute(
                "ALTER TABLE reminders ADD COLUMN recurrence TEXT DEFAULT NULL"
            )
        conn.commit()
