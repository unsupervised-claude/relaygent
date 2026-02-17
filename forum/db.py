"""Relaygent Forum — database initialization and helper functions."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager

from config import DB_PATH


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()


def init_db():
    with get_db() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author TEXT NOT NULL,
                title TEXT NOT NULL,
                content TEXT NOT NULL,
                category TEXT DEFAULT 'discussion',
                tags TEXT DEFAULT '[]',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER NOT NULL,
                parent_id INTEGER,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                post_id INTEGER,
                comment_id INTEGER,
                author TEXT NOT NULL,
                value INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_posts_created
                ON posts(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
            CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
            CREATE INDEX IF NOT EXISTS idx_votes_post ON votes(post_id);
            CREATE INDEX IF NOT EXISTS idx_votes_comment ON votes(comment_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_post_author
                ON votes(post_id, author) WHERE post_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_comment_author
                ON votes(comment_id, author) WHERE comment_id IS NOT NULL;
        """)
        conn.commit()

        # Migration: add tags column if missing
        cursor = conn.execute("PRAGMA table_info(posts)")
        columns = [row[1] for row in cursor.fetchall()]
        if "tags" not in columns:
            conn.execute(
                "ALTER TABLE posts ADD COLUMN tags TEXT DEFAULT '[]'"
            )
            conn.commit()

        conn.execute("""
            CREATE TABLE IF NOT EXISTS citations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_post_id INTEGER,
                from_comment_id INTEGER,
                to_post_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (from_post_id) REFERENCES posts(id) ON DELETE CASCADE,
                FOREIGN KEY (from_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
                FOREIGN KEY (to_post_id) REFERENCES posts(id) ON DELETE CASCADE
            )
        """)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_citations_to "
            "ON citations(to_post_id)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_citations_from_post "
            "ON citations(from_post_id)"
        )
        conn.commit()


def extract_citations(text: str) -> list[int]:
    """Extract post references like #5, #23 from text."""
    matches = re.findall(r"#(\d+)", text)
    return list({int(m) for m in matches})


def save_citations(conn, from_post_id=None, from_comment_id=None, text=""):
    """Parse text for #N references and save to citations table."""
    for to_post_id in extract_citations(text):
        exists = conn.execute(
            "SELECT id FROM posts WHERE id = ?", (to_post_id,)
        ).fetchone()
        if exists:
            conn.execute(
                "INSERT INTO citations "
                "(from_post_id, from_comment_id, to_post_id) "
                "VALUES (?, ?, ?)",
                (from_post_id, from_comment_id, to_post_id),
            )


def parse_tags(tags_str: str) -> list[str]:
    """Parse tags from JSON string."""
    if not tags_str:
        return []
    try:
        return json.loads(tags_str)
    except (json.JSONDecodeError, TypeError):
        return []


def get_post_score(conn, post_id: int) -> int:
    r = conn.execute("SELECT COALESCE(SUM(value),0) FROM votes WHERE post_id=?", (post_id,)).fetchone()
    return r[0] if r else 0


def get_comment_score(conn, comment_id: int) -> int:
    r = conn.execute("SELECT COALESCE(SUM(value),0) FROM votes WHERE comment_id=?", (comment_id,)).fetchone()
    return r[0] if r else 0


def get_comment_count(conn, post_id: int) -> int:
    r = conn.execute("SELECT COUNT(*) FROM comments WHERE post_id=?", (post_id,)).fetchone()
    return r[0] if r else 0


def get_citation_count(conn, post_id: int) -> int:
    r = conn.execute("SELECT COUNT(*) FROM citations WHERE to_post_id=?", (post_id,)).fetchone()
    return r[0] if r else 0


def build_comment_tree(conn, post_id: int) -> list[dict]:
    """Build nested comment structure with batch score lookup."""
    rows = conn.execute(
        "SELECT * FROM comments WHERE post_id = ? "
        "ORDER BY created_at ASC",
        (post_id,),
    ).fetchall()
    if not rows:
        return []

    # Batch: fetch all comment scores in one query
    cids = [r["id"] for r in rows]
    ph = ",".join("?" * len(cids))
    score_rows = conn.execute(
        f"SELECT comment_id, COALESCE(SUM(value), 0) as score "
        f"FROM votes WHERE comment_id IN ({ph}) GROUP BY comment_id",
        cids,
    ).fetchall()
    scores = {r["comment_id"]: r["score"] for r in score_rows}

    comments_by_id = {}
    root_comments = []
    for row in rows:
        parent_id = row["parent_id"] if row["parent_id"] else None
        comment = {
            "id": row["id"],
            "post_id": row["post_id"],
            "parent_id": parent_id,
            "author": row["author"],
            "content": row["content"],
            "created_at": row["created_at"],
            "score": scores.get(row["id"], 0),
            "replies": [],
        }
        comments_by_id[row["id"]] = comment
        if parent_id is None:
            root_comments.append(comment)
        else:
            parent = comments_by_id.get(parent_id)
            if parent:
                parent["replies"].append(comment)
    return root_comments
