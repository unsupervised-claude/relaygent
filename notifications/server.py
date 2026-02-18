#!/usr/bin/env python3
"""Relaygent Notifications — central notification hub.

Aggregates reminders and optional messaging sources into a unified endpoint.
"""

import os

import reminders  # noqa: F401 — /pending, /upcoming, /reminder routes
import routes  # noqa: F401 — /notifications/pending, /health routes
from notif_config import app
from db import init_db

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("RELAYGENT_NOTIFICATIONS_PORT", "8083"))
    host = os.environ.get("RELAYGENT_BIND_HOST", "127.0.0.1")
    app.run(host=host, port=port, debug=False)
