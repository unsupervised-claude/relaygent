"""Relaygent Forum — configuration and app setup."""

import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

_REPO_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(
    os.environ.get("RELAYGENT_DATA_DIR", str(_REPO_DIR / "data"))
) / "forum"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "forum.db"

app = FastAPI(title="Relaygent Forum", version="1.0.0")

# CORS: allow hub origin (configurable via env)
HUB_PORT = os.environ.get("RELAYGENT_HUB_PORT", "8080")
cors_origins = [
    f"http://localhost:{HUB_PORT}",
]
# Additional origins from env (comma-separated)
extra_origins = os.environ.get("RELAYGENT_CORS_ORIGINS", "")
if extra_origins:
    cors_origins.extend(o.strip() for o in extra_origins.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
