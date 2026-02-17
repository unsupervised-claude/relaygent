"""Tests for forum post CRUD, listing, filtering, and sorting."""

from conftest import client, make_post
from db import extract_citations, parse_tags


# --- Health / meta ---


def test_root():
    r = client.get("/")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "healthy"


# --- Posts CRUD ---


def test_create_post():
    r = make_post()
    assert r.status_code == 200
    d = r.json()
    assert d["author"] == "tester"
    assert d["title"] == "Test"
    assert d["score"] == 0
    assert d["comment_count"] == 0


def test_create_post_with_tags():
    r = make_post(tags=["meta", "test"])
    assert r.status_code == 200
    assert set(r.json()["tags"]) == {"meta", "test"}


def test_create_post_invalid_category():
    r = make_post(category="invalid")
    assert r.status_code == 400


def test_create_post_missing_fields():
    r = client.post("/posts", json={"author": "x"})
    assert r.status_code == 422


def test_list_posts():
    make_post(title="A")
    make_post(title="B")
    r = client.get("/posts")
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_list_posts_filter_category():
    make_post(category="idea")
    make_post(category="question")
    r = client.get("/posts?category=idea")
    posts = r.json()
    assert len(posts) == 1
    assert posts[0]["category"] == "idea"


def test_list_posts_filter_tag():
    make_post(tags=["alpha"])
    make_post(tags=["beta"])
    r = client.get("/posts?tag=alpha")
    posts = r.json()
    assert len(posts) == 1
    assert "alpha" in posts[0]["tags"]


def test_list_posts_limit():
    for i in range(5):
        make_post(title=f"P{i}")
    r = client.get("/posts?limit=3")
    assert len(r.json()) == 3


def test_get_post():
    pid = make_post().json()["id"]
    r = client.get(f"/posts/{pid}")
    assert r.status_code == 200
    assert r.json()["id"] == pid
    assert r.json()["comments"] == []


def test_get_post_not_found():
    r = client.get("/posts/9999")
    assert r.status_code == 404


def test_delete_post():
    pid = make_post().json()["id"]
    r = client.delete(f"/posts/{pid}?author=tester")
    assert r.status_code == 200
    assert client.get(f"/posts/{pid}").status_code == 404


def test_delete_post_wrong_author():
    pid = make_post().json()["id"]
    r = client.delete(f"/posts/{pid}?author=other")
    assert r.status_code == 403


# --- Sort ---


def test_sort_top():
    make_post(title="Low")
    p2 = make_post(title="High").json()["id"]
    client.post(f"/posts/{p2}/vote", json={"author": "v", "value": 1})
    r = client.get("/posts?sort=top")
    assert r.json()[0]["id"] == p2


def test_sort_hot():
    p1 = make_post(title="Old").json()["id"]
    p2 = make_post(title="New").json()["id"]
    client.post(f"/posts/{p1}/vote", json={"author": "v1", "value": 1})
    client.post(f"/posts/{p2}/vote", json={"author": "v2", "value": 1})
    r = client.get("/posts?sort=hot")
    # Both have same score but p2 is newer, so higher hot score
    assert r.json()[0]["id"] == p2


# --- Unit tests for db helpers ---


def test_extract_citations():
    assert extract_citations("See #5 and #23") == [5, 23]
    assert extract_citations("No refs here") == []
    assert extract_citations("#1 #1 #1") == [1]


def test_parse_tags():
    assert parse_tags('["a","b"]') == ["a", "b"]
    assert parse_tags("") == []
    assert parse_tags("not json") == []
    assert parse_tags(None) == []
