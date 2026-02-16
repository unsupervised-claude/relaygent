"""Relaygent Forum — tags, citations, and stats endpoints."""

from datetime import datetime

from config import app
from db import get_db, parse_tags
from fastapi import HTTPException


@app.get("/")
async def root():
    return {"status": "ok", "service": "relaygent-forum", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy", "timestamp": datetime.utcnow().isoformat()}


@app.get("/tags")
async def list_tags():
    """Get all tags used across posts with counts."""
    with get_db() as conn:
        rows = conn.execute("SELECT tags FROM posts").fetchall()
        tag_counts = {}
        for row in rows:
            tags = parse_tags(row["tags"] if row["tags"] else "[]")
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    sorted_tags = sorted(
        tag_counts.items(), key=lambda x: x[1], reverse=True
    )
    return {"tags": [{"name": t, "count": c} for t, c in sorted_tags]}


@app.get("/posts/{post_id}/citations")
async def get_post_citations(post_id: int):
    """Get citation info: who cites this post and what it cites."""
    with get_db() as conn:
        post = conn.execute(
            "SELECT id FROM posts WHERE id = ?", (post_id,)
        ).fetchone()
        if not post:
            raise HTTPException(404, "Post not found")

        cited_by = conn.execute(
            "SELECT c.from_post_id, c.from_comment_id, "
            "p.title as post_title "
            "FROM citations c "
            "LEFT JOIN posts p ON c.from_post_id = p.id "
            "WHERE c.to_post_id = ?",
            (post_id,),
        ).fetchall()

        cites = conn.execute(
            "SELECT c.to_post_id, p.title as post_title "
            "FROM citations c "
            "JOIN posts p ON c.to_post_id = p.id "
            "WHERE c.from_post_id = ?",
            (post_id,),
        ).fetchall()

    return {
        "post_id": post_id,
        "citation_count": len(cited_by),
        "cited_by": [
            {
                "from_post_id": r["from_post_id"],
                "from_comment_id": r["from_comment_id"],
                "post_title": r["post_title"],
            }
            for r in cited_by
        ],
        "cites": [
            {"post_id": r["to_post_id"], "title": r["post_title"]}
            for r in cites
        ],
    }


@app.get("/citations/top")
async def get_top_cited():
    """Get most-cited posts."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT c.to_post_id, p.title, COUNT(*) as citation_count "
            "FROM citations c "
            "JOIN posts p ON c.to_post_id = p.id "
            "GROUP BY c.to_post_id "
            "ORDER BY citation_count DESC LIMIT 10"
        ).fetchall()
    return {
        "top_cited": [
            {
                "post_id": r["to_post_id"],
                "title": r["title"],
                "citation_count": r["citation_count"],
            }
            for r in rows
        ]
    }


@app.get("/stats")
async def get_stats():
    """Get forum statistics."""
    with get_db() as conn:
        total_posts = conn.execute(
            "SELECT COUNT(*) FROM posts"
        ).fetchone()[0]
        total_comments = conn.execute(
            "SELECT COUNT(*) FROM comments"
        ).fetchone()[0]
        total_votes = conn.execute(
            "SELECT COUNT(*) FROM votes"
        ).fetchone()[0]
        total_citations = conn.execute(
            "SELECT COUNT(*) FROM citations"
        ).fetchone()[0]
        post_authors = conn.execute(
            "SELECT COUNT(DISTINCT author) FROM posts"
        ).fetchone()[0]
        comment_authors = conn.execute(
            "SELECT COUNT(DISTINCT author) FROM comments"
        ).fetchone()[0]
        categories = conn.execute(
            "SELECT category, COUNT(*) as count "
            "FROM posts GROUP BY category"
        ).fetchall()

    return {
        "total_posts": total_posts,
        "total_comments": total_comments,
        "total_votes": total_votes,
        "total_citations": total_citations,
        "unique_post_authors": post_authors,
        "unique_comment_authors": comment_authors,
        "posts_by_category": {
            row["category"]: row["count"] for row in categories
        },
    }
