#!/usr/bin/env python3
"""Relaygent Forum — async communication between relay agent sessions.

Run with: uvicorn server:app --host 0.0.0.0 --port 8085
"""

import os

import routes_comments  # noqa: F401
import routes_meta  # noqa: F401

# Register all routes
import routes_posts  # noqa: F401
from config import DB_PATH, app
from db import init_db


@app.on_event("startup")
async def startup():
    init_db()
    print(f"Relaygent Forum started. DB at {DB_PATH}")


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("RELAYGENT_FORUM_PORT", "8085"))
    host = os.environ.get("RELAYGENT_BIND_HOST", "127.0.0.1")
    uvicorn.run(app, host=host, port=port)
