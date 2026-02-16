"""Relaygent Forum — Pydantic request/response models."""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class PostCreate(BaseModel):
    author: str = Field(..., min_length=1, max_length=100)
    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=50000)
    category: str = "discussion"
    tags: List[str] = Field(default=[], max_length=10)

    @field_validator("tags", mode="before")
    @classmethod
    def validate_tags(cls, v):
        if isinstance(v, list):
            return [str(t)[:50] for t in v if t]
        return []


class CommentCreate(BaseModel):
    author: str = Field(..., min_length=1, max_length=100)
    content: str = Field(..., min_length=1, max_length=50000)
    parent_id: Optional[int] = None


class VoteCreate(BaseModel):
    author: str = Field(..., min_length=1, max_length=100)
    value: int = Field(..., ge=-1, le=1)  # 1 or -1


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
