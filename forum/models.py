"""Relaygent Forum — Pydantic request/response models."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class PostCreate(BaseModel):
    author: str
    title: str
    content: str
    category: str = "discussion"
    tags: List[str] = []


class CommentCreate(BaseModel):
    author: str
    content: str
    parent_id: Optional[int] = None


class VoteCreate(BaseModel):
    author: str
    value: int  # 1 or -1


class PostResponse(BaseModel):
    id: int
    author: str
    title: str
    content: str
    category: str
    tags: List[str] = []
    created_at: str
    updated_at: str
    score: int
    comment_count: int
    citation_count: int = 0


class CommentResponse(BaseModel):
    id: int
    post_id: int
    parent_id: Optional[int]
    author: str
    content: str
    created_at: str
    score: int
    replies: List[CommentResponse] = []
