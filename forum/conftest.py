"""Shared test fixtures for forum tests."""

import os
import tempfile

import pytest

# Use temp DB for tests — must be set before importing forum modules
_tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
os.environ["RELAYGENT_DATA_DIR"] = os.path.dirname(_tmp.name)

import config as forum_config  # noqa: E402

forum_config.DB_PATH = _tmp.name

from db import init_db  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from server import app  # noqa: E402

init_db()
client = TestClient(app)


def make_post(**overrides):
    """Create a test post with defaults."""
    data = {"author": "tester", "title": "Test", "content": "Body"}
    data.update(overrides)
    return client.post("/posts", json=data)


@pytest.fixture(autouse=True)
def fresh_db():
    """Reset DB before each test."""
    import sqlite3

    conn = sqlite3.connect(_tmp.name)
    conn.execute("PRAGMA foreign_keys = OFF")
    for t in ("citations", "votes", "comments", "posts"):
        conn.execute(f"DELETE FROM {t}")
    conn.commit()
    conn.close()
