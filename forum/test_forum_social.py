"""Tests for forum comments, votes, citations, tags, and stats."""

from conftest import client, make_post


# --- Comments ---


def test_create_comment():
    pid = make_post().json()["id"]
    r = client.post(
        f"/posts/{pid}/comments",
        json={"author": "commenter", "content": "Nice post"},
    )
    assert r.status_code == 200
    assert r.json()["author"] == "commenter"
    assert r.json()["post_id"] == pid


def test_create_nested_comment():
    pid = make_post().json()["id"]
    c1 = client.post(
        f"/posts/{pid}/comments",
        json={"author": "a", "content": "Top level"},
    ).json()
    c2 = client.post(
        f"/posts/{pid}/comments",
        json={"author": "b", "content": "Reply", "parent_id": c1["id"]},
    )
    assert c2.status_code == 200
    assert c2.json()["parent_id"] == c1["id"]


def test_comment_on_nonexistent_post():
    r = client.post(
        "/posts/9999/comments",
        json={"author": "x", "content": "y"},
    )
    assert r.status_code == 404


def test_comment_invalid_parent():
    pid = make_post().json()["id"]
    r = client.post(
        f"/posts/{pid}/comments",
        json={"author": "x", "content": "y", "parent_id": 9999},
    )
    assert r.status_code == 404


def test_comment_tree():
    pid = make_post().json()["id"]
    c1 = client.post(
        f"/posts/{pid}/comments",
        json={"author": "a", "content": "Root"},
    ).json()
    client.post(
        f"/posts/{pid}/comments",
        json={"author": "b", "content": "Reply", "parent_id": c1["id"]},
    )
    post = client.get(f"/posts/{pid}").json()
    assert len(post["comments"]) == 1
    assert len(post["comments"][0]["replies"]) == 1


# --- Votes ---


def test_vote_on_post():
    pid = make_post().json()["id"]
    r = client.post(
        f"/posts/{pid}/vote", json={"author": "voter", "value": 1}
    )
    assert r.status_code == 200
    assert r.json()["status"] == "added"
    assert r.json()["new_score"] == 1


def test_vote_toggle_removes():
    pid = make_post().json()["id"]
    client.post(f"/posts/{pid}/vote", json={"author": "v", "value": 1})
    r = client.post(f"/posts/{pid}/vote", json={"author": "v", "value": 1})
    assert r.json()["status"] == "removed"
    assert r.json()["new_score"] == 0


def test_vote_change():
    pid = make_post().json()["id"]
    client.post(f"/posts/{pid}/vote", json={"author": "v", "value": 1})
    r = client.post(f"/posts/{pid}/vote", json={"author": "v", "value": -1})
    assert r.json()["status"] == "changed"
    assert r.json()["new_score"] == -1


def test_vote_on_comment():
    pid = make_post().json()["id"]
    cid = client.post(
        f"/posts/{pid}/comments",
        json={"author": "a", "content": "x"},
    ).json()["id"]
    r = client.post(
        f"/comments/{cid}/vote", json={"author": "v", "value": 1}
    )
    assert r.status_code == 200
    assert r.json()["new_score"] == 1


def test_vote_invalid_value():
    pid = make_post().json()["id"]
    r = client.post(
        f"/posts/{pid}/vote", json={"author": "v", "value": 5}
    )
    assert r.status_code == 422


def test_vote_nonexistent_post():
    r = client.post(
        "/posts/9999/vote", json={"author": "v", "value": 1}
    )
    assert r.status_code == 404


# --- Citations ---


def test_citation_created():
    p1 = make_post(title="Target").json()["id"]
    p2 = make_post(title="Citer", content=f"See #{p1}").json()["id"]
    r = client.get(f"/posts/{p1}/citations")
    assert r.status_code == 200
    assert r.json()["citation_count"] == 1
    assert r.json()["cited_by"][0]["from_post_id"] == p2


def test_citation_from_comment():
    p1 = make_post(title="Target").json()["id"]
    p2 = make_post(title="Other").json()["id"]
    client.post(
        f"/posts/{p2}/comments",
        json={"author": "c", "content": f"Refs #{p1}"},
    )
    r = client.get(f"/posts/{p1}/citations")
    assert r.json()["citation_count"] == 1


def test_top_cited():
    p1 = make_post(title="Popular").json()["id"]
    make_post(content=f"See #{p1}")
    make_post(content=f"Also #{p1}")
    r = client.get("/citations/top")
    assert r.status_code == 200
    top = r.json()["top_cited"]
    assert len(top) >= 1
    assert top[0]["post_id"] == p1
    assert top[0]["citation_count"] == 2


# --- Tags ---


def test_tags_endpoint():
    make_post(tags=["alpha", "beta"])
    make_post(tags=["alpha"])
    r = client.get("/tags")
    assert r.status_code == 200
    tags = {t["name"]: t["count"] for t in r.json()["tags"]}
    assert tags["alpha"] == 2
    assert tags["beta"] == 1


# --- Stats ---


def test_stats_empty():
    r = client.get("/stats")
    assert r.status_code == 200
    d = r.json()
    assert d["total_posts"] == 0
    assert d["total_comments"] == 0


def test_stats_populated():
    pid = make_post(category="idea").json()["id"]
    client.post(
        f"/posts/{pid}/comments",
        json={"author": "c", "content": "Hi"},
    )
    client.post(f"/posts/{pid}/vote", json={"author": "v", "value": 1})
    r = client.get("/stats")
    d = r.json()
    assert d["total_posts"] == 1
    assert d["total_comments"] == 1
    assert d["total_votes"] == 1
    assert d["posts_by_category"]["idea"] == 1
