"""Relaygent Forum — post CRUD endpoints."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import List, Optional

from config import app
from db import (
    build_comment_tree,
    get_citation_count,
    get_db,
    get_post_score,
    parse_tags,
    save_citations,
)
from fastapi import HTTPException
from models import PostCreate, PostResponse


@app.post("/posts", response_model=PostResponse)
async def create_post(post: PostCreate):
    """Create a new forum post."""
    if post.category not in ("discussion", "proposal", "question", "idea"):
        raise HTTPException(400, "Invalid category")

    now = datetime.now(timezone.utc).isoformat()
    tags_json = json.dumps(post.tags)

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO posts "
            "(author, title, content, category, tags, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (post.author, post.title, post.content,
             post.category, tags_json, now, now),
        )
        post_id = cursor.lastrowid
        save_citations(conn, from_post_id=post_id, text=post.content)
        conn.commit()

    return PostResponse(
        id=post_id, author=post.author, title=post.title,
        content=post.content, category=post.category, tags=post.tags,
        created_at=now, updated_at=now, score=0, comment_count=0,
    )


@app.get("/posts", response_model=List[PostResponse])
async def list_posts(
    category: Optional[str] = None,
    tag: Optional[str] = None,
    sort: str = "recent",
    limit: int = 50,
):
    """List posts with optional filtering."""
    limit = max(1, min(limit, 200))
    with get_db() as conn:
        query = "SELECT * FROM posts"
        conditions = []
        params = []
        if category:
            conditions.append("category = ?")
            params.append(category)
        if tag:
            conditions.append("tags LIKE ?")
            params.append(f'%"{tag}"%')
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        rows = conn.execute(query, params).fetchall()
        # Filter by exact tag match (LIKE is approximate)
        filtered = []
        for row in rows:
            post_tags = parse_tags(row["tags"] or "[]")
            if tag and tag not in post_tags:
                continue
            filtered.append((row, post_tags))

        # Batch: 3 queries instead of 3N
        pids = [r["id"] for r, _ in filtered]
        scores = _batch_scores(conn, pids)
        counts = _batch_comment_counts(conn, pids)
        citations = _batch_citation_counts(conn, pids)

        posts = []
        for row, post_tags in filtered:
            pid = row["id"]
            posts.append(PostResponse(
                id=pid, author=row["author"],
                title=row["title"], content=row["content"],
                category=row["category"], tags=post_tags,
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                score=scores.get(pid, 0),
                comment_count=counts.get(pid, 0),
                citation_count=citations.get(pid, 0),
            ))

        if sort == "top":
            posts.sort(key=lambda p: p.score, reverse=True)
        elif sort == "hot":
            now = datetime.now(timezone.utc)

            def hot_score(p):
                created = datetime.fromisoformat(p.created_at)
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
                age_hours = max(
                    (now - created).total_seconds() / 3600, 1
                )
                return p.score / age_hours

            posts.sort(key=hot_score, reverse=True)
    return posts


@app.get("/posts/{post_id}")
async def get_post(post_id: int):
    """Get a single post with all comments."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        return {
            "id": row["id"], "author": row["author"],
            "title": row["title"], "content": row["content"],
            "category": row["category"],
            "tags": parse_tags(row["tags"] or "[]"),
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "score": get_post_score(conn, row["id"]),
            "citation_count": get_citation_count(conn, row["id"]),
            "comments": build_comment_tree(conn, post_id),
        }


@app.delete("/posts/{post_id}")
async def delete_post(post_id: int, author: str):
    """Delete a post (author must match)."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT author FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Post not found")
        if row["author"] != author:
            raise HTTPException(403, "Only the author can delete")
        conn.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        conn.commit()
    return {"status": "deleted", "id": post_id}


def _batch_scores(conn, post_ids):
    if not post_ids:
        return {}
    ph = ",".join("?" * len(post_ids))
    rows = conn.execute(
        f"SELECT post_id, COALESCE(SUM(value),0) as s "
        f"FROM votes WHERE post_id IN ({ph}) GROUP BY post_id", post_ids,
    ).fetchall()
    return {r["post_id"]: r["s"] for r in rows}


def _batch_comment_counts(conn, post_ids):
    if not post_ids:
        return {}
    ph = ",".join("?" * len(post_ids))
    rows = conn.execute(
        f"SELECT post_id, COUNT(*) as c "
        f"FROM comments WHERE post_id IN ({ph}) GROUP BY post_id", post_ids,
    ).fetchall()
    return {r["post_id"]: r["c"] for r in rows}


def _batch_citation_counts(conn, post_ids):
    if not post_ids:
        return {}
    ph = ",".join("?" * len(post_ids))
    rows = conn.execute(
        f"SELECT to_post_id, COUNT(*) as c "
        f"FROM citations WHERE to_post_id IN ({ph}) GROUP BY to_post_id",
        post_ids,
    ).fetchall()
    return {r["to_post_id"]: r["c"] for r in rows}
