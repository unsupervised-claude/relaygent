#!/usr/bin/env python3
"""Linux computer-use HTTP server — drop-in replacement for Hammerspoon.

Same API on port 8097, backed by xdotool + scrot + pyatspi2.
Install: apt install xdotool scrot wmctrl imagemagick python3-pyatspi at-spi2-core
"""
from __future__ import annotations

import json
import os
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler

import linux_input as inp
import linux_display as display
import linux_a11y as a11y

PORT = int(os.environ.get("HAMMERSPOON_PORT", "8097"))


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _respond(self, body: dict, code: int = 200):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", len(data))
        self.end_headers()
        self.wfile.write(data)

    def _read_body(self) -> dict:
        length = int(self.headers.get("Content-Length", 0))
        if length == 0:
            return {}
        try:
            return json.loads(self.rfile.read(length))
        except Exception:
            return {}

    def do_GET(self):
        routes = {
            "/health": lambda _: ({"status": "ok", "platform": "linux"}, 200),
            "/windows": display.windows,
            "/apps": display.apps,
        }
        handler = routes.get(self.path)
        if handler:
            body, code = handler({})
            self._respond(body, code)
        else:
            self._respond({"error": "not found", "path": self.path}, 404)

    def do_POST(self):
        params = self._read_body()
        routes = {
            "/screenshot": display.screenshot,
            "/click": inp.click,
            "/type": inp.type_input,
            "/drag": inp.drag,
            "/scroll": inp.scroll,
            "/type_from_file": inp.type_from_file,
            "/focus": display.focus,
            "/launch": display.launch,
            "/element_at": a11y.element_at,
            "/accessibility": a11y.accessibility_tree,
            "/ax_press": a11y.ax_press,
            "/reload": lambda _: ({"status": "ok", "note": "no-op on linux"}, 200),
        }
        handler = routes.get(self.path)
        if handler:
            try:
                body, code = handler(params)
            except Exception as e:
                body, code = {"error": str(e)}, 500
            self._respond(body, code)
        else:
            self._respond({"error": "not found", "path": self.path}, 404)


if __name__ == "__main__":
    server = HTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Linux computer-use API on localhost:{PORT}", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
