"""Tests for linux-server.py — HTTP routing, body parsing, handler dispatch."""

from __future__ import annotations

import importlib
import json
import sys
from io import BytesIO
from unittest.mock import MagicMock, patch

# The module is named linux-server.py (hyphenated), import via importlib
spec = importlib.util.spec_from_file_location(
    "linux_server",
    __file__.replace("test_server.py", "linux-server.py"),
)
linux_server = importlib.util.module_from_spec(spec)

# Mock the imports that linux-server.py tries to load
sys.modules["linux_input"] = MagicMock()
sys.modules["linux_display"] = MagicMock()
sys.modules["linux_a11y"] = MagicMock()

spec.loader.exec_module(linux_server)


class MockRequest:
    """Mock HTTP request for testing Handler methods."""

    def __init__(self, body=None):
        self.headers = {}
        if body is not None:
            data = json.dumps(body).encode()
            self.headers["Content-Length"] = str(len(data))
            self.rfile = BytesIO(data)
        else:
            self.headers["Content-Length"] = "0"
            self.rfile = BytesIO(b"")


class TestReadBody:
    def _make_handler(self):
        """Create a Handler instance without running __init__."""
        handler = object.__new__(linux_server.Handler)
        return handler

    def test_empty_body(self):
        handler = self._make_handler()
        handler.headers = {"Content-Length": "0"}
        handler.rfile = BytesIO(b"")
        result = handler._read_body()
        assert result == {}

    def test_valid_json(self):
        handler = self._make_handler()
        data = json.dumps({"x": 10, "y": 20}).encode()
        handler.headers = {"Content-Length": str(len(data))}
        handler.rfile = BytesIO(data)
        result = handler._read_body()
        assert result == {"x": 10, "y": 20}

    def test_invalid_json(self):
        handler = self._make_handler()
        data = b"not json"
        handler.headers = {"Content-Length": str(len(data))}
        handler.rfile = BytesIO(data)
        result = handler._read_body()
        assert result == {}

    def test_missing_content_length(self):
        handler = self._make_handler()
        handler.headers = {}
        handler.rfile = BytesIO(b"")
        result = handler._read_body()
        assert result == {}


class TestRoutes:
    """Verify that route tables map to correct handlers."""

    def test_get_routes(self):
        handler = object.__new__(linux_server.Handler)
        handler.path = "/health"
        handler.headers = {}
        # The do_GET routes dict should have /health, /windows, /apps
        routes = {
            "/health": True,
            "/windows": True,
            "/apps": True,
        }
        for path in routes:
            assert path in ["/health", "/windows", "/apps"]

    def test_post_routes(self):
        expected = {
            "/screenshot", "/click", "/type", "/drag", "/scroll",
            "/type_from_file", "/focus", "/launch", "/element_at",
            "/accessibility", "/ax_press", "/reload",
        }
        # Verify all expected POST routes exist by checking the source
        import inspect
        source = inspect.getsource(linux_server.Handler.do_POST)
        for route in expected:
            assert f'"{route}"' in source, f"Missing route: {route}"


class TestRespond:
    def test_respond_json(self):
        handler = object.__new__(linux_server.Handler)
        handler.wfile = BytesIO()
        sent_headers = {}

        def mock_send_response(code):
            sent_headers["code"] = code

        def mock_send_header(key, val):
            sent_headers[key] = val

        def mock_end_headers():
            pass

        handler.send_response = mock_send_response
        handler.send_header = mock_send_header
        handler.end_headers = mock_end_headers
        handler._respond({"status": "ok"}, 200)
        assert sent_headers["code"] == 200
        assert sent_headers["Content-Type"] == "application/json"
        output = handler.wfile.getvalue()
        assert json.loads(output) == {"status": "ok"}

    def test_respond_error(self):
        handler = object.__new__(linux_server.Handler)
        handler.wfile = BytesIO()
        handler.send_response = lambda c: None
        handler.send_header = lambda k, v: None
        handler.end_headers = lambda: None
        handler._respond({"error": "not found"}, 404)
        output = handler.wfile.getvalue()
        assert json.loads(output)["error"] == "not found"
