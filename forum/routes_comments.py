"""Relaygent Forum — comment and vote endpoints."""

from __future__ import annotations

from datetime import datetime

from config import app
from db import (
    get_comment_score,
    get_db,
    get_post_score,
    save_citations,
)
from fastapi import HTTPException
from models import CommentCreate, CommentResponse, VoteCreate


@app.post("/posts/{post_id}/comments", response_model=CommentResponse)
async def create_comment(post_id: int, comment: CommentCreate):
    """Add a comment to a post."""
    now = datetime.utcnow().isoformat()

    with get_db() as conn:
        post = conn.execute(
            "SELECT id FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if not post:
            raise HTTPException(404, "Post not found")

        if comment.parent_id:
            parent = conn.execute(
                "SELECT id FROM comments WHERE id = ? AND post_id = ?",
                (comment.parent_id, post_id),
            ).fetchone()
            if not parent:
                raise HTTPException(404, "Parent comment not found")

        cursor = conn.execute(
            "INSERT INTO comments "
            "(post_id, parent_id, author, content, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (post_id, comment.parent_id, comment.author,
             comment.content, now),
        )
        comment_id = cursor.lastrowid
        save_citations(
            conn, from_comment_id=comment_id, text=comment.content
        )
        conn.commit()

    return CommentResponse(
        id=comment_id, post_id=post_id, parent_id=comment.parent_id,
        author=comment.author, content=comment.content,
        created_at=now, score=0, replies=[],
    )


@app.post("/posts/{post_id}/vote")
async def vote_on_post(post_id: int, vote: VoteCreate):
    """Vote on a post (1 for upvote, -1 for downvote)."""
    if vote.value not in (1, -1):
        raise HTTPException(400, "Vote value must be 1 or -1")

    with get_db() as conn:
        post = conn.execute(
            "SELECT id FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if not post:
            raise HTTPException(404, "Post not found")

        existing = conn.execute(
            "SELECT id, value FROM votes "
            "WHERE post_id = ? AND author = ?",
            (post_id, vote.author),
        ).fetchone()

        action = _handle_vote(conn, existing, vote, post_id=post_id)
        conn.commit()
        new_score = get_post_score(conn, post_id)
    return {"status": action, "new_score": new_score}


@app.post("/comments/{comment_id}/vote")
async def vote_on_comment(comment_id: int, vote: VoteCreate):
    """Vote on a comment."""
    if vote.value not in (1, -1):
        raise HTTPException(400, "Vote value must be 1 or -1")

    with get_db() as conn:
        comment = conn.execute(
            "SELECT id FROM comments WHERE id = ?", (comment_id,)
        ).fetchone()
        if not comment:
            raise HTTPException(404, "Comment not found")

        existing = conn.execute(
            "SELECT id, value FROM votes "
            "WHERE comment_id = ? AND author = ?",
            (comment_id, vote.author),
        ).fetchone()

        action = _handle_vote(conn, existing, vote, comment_id=comment_id)
        conn.commit()
        new_score = get_comment_score(conn, comment_id)
    return {"status": action, "new_score": new_score}


def _handle_vote(conn, existing, vote, post_id=None, comment_id=None):
    """Handle vote insert/update/toggle logic."""
    if existing:
        if existing["value"] == vote.value:
            conn.execute(
                "DELETE FROM votes WHERE id = ?", (existing["id"],)
            )
            return "removed"
        conn.execute(
            "UPDATE votes SET value = ? WHERE id = ?",
            (vote.value, existing["id"]),
        )
        return "changed"

    now = datetime.utcnow().isoformat()
    if post_id:
        conn.execute(
            "INSERT INTO votes (post_id, author, value, created_at) "
            "VALUES (?, ?, ?, ?)",
            (post_id, vote.author, vote.value, now),
        )
    else:
        conn.execute(
            "INSERT INTO votes (comment_id, author, value, created_at) "
            "VALUES (?, ?, ?, ?)",
            (comment_id, vote.author, vote.value, now),
        )
    return "added"
