"""Slack notification collector — checks all channels for new messages."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request

from notif_config import app
from flask import jsonify

logger = logging.getLogger(__name__)

SLACK_TOKEN_PATH = os.path.join(
    os.path.expanduser("~"), ".relaygent", "slack", "token.json"
)
_LAST_CHECK_FILE = os.path.join(
    os.path.expanduser("~"), ".relaygent", "slack", ".last_check_ts"
)


_SELF_UID = None


def _get_self_uid(token):
    """Get our own Slack user ID (cached)."""
    global _SELF_UID
    if _SELF_UID:
        return _SELF_UID
    result = _slack_api(token, "auth.test")
    if result:
        _SELF_UID = result.get("user_id")
    return _SELF_UID


def _slack_api(token, method, params=None, _retries=2):
    """Call a Slack Web API method. Returns parsed JSON or None.

    Retries on 429 (rate limit) up to _retries times, capped at 10s.
    """
    url = f"https://slack.com/api/{method}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {token}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
        if not data.get("ok"):
            logger.debug("Slack API %s returned ok=false: %s",
                         method, data.get("error", "unknown"))
        return data if data.get("ok") else None
    except urllib.error.HTTPError as e:
        if e.code == 429 and _retries > 0:
            retry_after = min(int(e.headers.get("Retry-After", "5")), 10)
            logger.info("Slack rate limited, waiting %ds", retry_after)
            time.sleep(retry_after)
            return _slack_api(token, method, params, _retries - 1)
        logger.warning("Slack API %s HTTP %d", method, e.code)
        return None
    except (urllib.error.URLError, OSError) as e:
        logger.warning("Slack API %s network error: %s", method, e)
        return None


def _load_token():
    """Read Slack token from disk. Returns token string or None."""
    if not os.path.exists(SLACK_TOKEN_PATH):
        return None
    try:
        with open(SLACK_TOKEN_PATH) as f:
            return json.loads(f.read()).get("access_token")
    except (json.JSONDecodeError, OSError):
        return None


def collect(notifications):
    """Check all Slack channels for new messages since last check.

    Uses conversations.history per-channel with timestamp tracking,
    because conversations.list doesn't return unread_count_display
    for user (xoxp) tokens.
    """
    token = _load_token()
    if not token:
        return
    last_ts = "0"
    try:
        if os.path.exists(_LAST_CHECK_FILE):
            with open(_LAST_CHECK_FILE) as f:
                last_ts = f.read().strip() or "0"
    except OSError as e:
        logger.warning("Failed to read Slack last-check timestamp: %s", e)

    self_uid = _get_self_uid(token)
    result = _slack_api(token, "conversations.list", {
        "limit": 50,
        "types": "public_channel,private_channel,im,mpim",
        "exclude_archived": "true",
    })
    if not result:
        return

    skip_subtypes = {"channel_join", "joiner_notification_for_inviter"}
    unread_channels = []
    for ch in result.get("channels") or []:
        hist = _slack_api(token, "conversations.history", {
            "channel": ch["id"], "limit": 10, "oldest": last_ts,
        })
        if not hist:
            continue
        msgs = [m for m in (hist.get("messages") or [])
                if m.get("subtype") not in skip_subtypes
                and m.get("user") != self_uid]
        if msgs and msgs[0].get("ts", "0") > last_ts:
            # Include message previews (newest-first → reverse for chronological)
            previews = [
                {"user": m.get("user", ""), "text": m.get("text", ""), "ts": m.get("ts", "")}
                for m in reversed(msgs[:5])
            ]
            unread_channels.append({
                "id": ch["id"],
                "name": ch.get("name", ch["id"]),
                "unread": len(msgs),
                "messages": previews,
            })

    if unread_channels:
        notifications.append({
            "type": "message",
            "source": "slack",
            "count": sum(c["unread"] for c in unread_channels),
            "channels": unread_channels,
        })


def ack():
    """Advance Slack read marker to now."""
    try:
        os.makedirs(os.path.dirname(_LAST_CHECK_FILE), exist_ok=True)
        with open(_LAST_CHECK_FILE, "w") as f:
            # Use 6 decimal places to match Slack ts format
            f.write(f"{time.time():.6f}")
    except OSError as e:
        logger.warning("Failed to write Slack ack timestamp: %s", e)


@app.route("/notifications/ack-slack", methods=["POST"])
def ack_slack():
    """HTTP endpoint — called by harness after wake."""
    ack()
    return jsonify({"status": "ok"})
