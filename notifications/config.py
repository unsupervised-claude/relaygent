"""Relaygent Notifications — configuration and app setup."""

import logging
import os

from flask import Flask

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)

app = Flask(__name__)

_REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.environ.get("RELAYGENT_DATA_DIR", os.path.join(_REPO_DIR, "data"))
DB_PATH = os.path.join(DATA_DIR, "reminders.db")

try:
    from croniter import croniter  # noqa: F401
    CRONITER_AVAILABLE = True
except ImportError:
    CRONITER_AVAILABLE = False
