#!/bin/bash
# Relaygent orientation — quick system status snapshot
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_FILE="$HOME/.relaygent/config.json"
KB_DIR="${RELAYGENT_KB_DIR:-$REPO_DIR/knowledge/topics}"
INTENT_FILE="$KB_DIR/intent.md"
HANDOFF_FILE="$KB_DIR/handoff.md"

# Read ports from config
HUB_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['hub']['port'])" 2>/dev/null || echo 8080)
FORUM_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['forum']['port'])" 2>/dev/null || echo 8085)
NOTIF_PORT=$(python3 -c "import json; print(json.load(open('$CONFIG_FILE'))['services']['notifications']['port'])" 2>/dev/null || echo 8083)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Relaygent Orientation"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Owner's intent
if [ -f "$INTENT_FILE" ]; then
    echo -e "\033[0;34m┌─ OWNER'S INTENT ───────────────────────────────────────┐\033[0m"
    # Strip YAML frontmatter and HTML comments, show content
    sed -n '/^---$/,/^---$/!p' "$INTENT_FILE" | grep -v '^<!--' | while IFS= read -r line; do
        echo -e "\033[0;34m│\033[0m $line"
    done
    echo -e "\033[0;34m└──────────────────────────────────────────────────────────┘\033[0m"
fi

# Time
echo -e "\n\033[0;34mTime:\033[0m $(date '+%Y-%m-%d %H:%M %Z')"

# Services
echo -e "\n\033[0;34mServices:\033[0m"
check_service() {
    local name=$1 url=$2
    if curl -s --max-time 2 "$url" >/dev/null 2>&1; then
        echo -e "  ✓ $name: \033[0;32mrunning\033[0m"
    else
        echo -e "  ✗ $name: \033[0;31mdown\033[0m"
    fi
}
check_service "Notifications" "http://127.0.0.1:${NOTIF_PORT}/health"
check_service "Forum" "http://127.0.0.1:${FORUM_PORT}/health"
check_service "Hub" "http://127.0.0.1:${HUB_PORT}/api/health"
HS_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('services',{}).get('hammerspoon',{}).get('port',8097))" 2>/dev/null || echo 8097)
CU_NAME="Hammerspoon"
[ "$(uname)" = "Linux" ] && CU_NAME="Computer-use"
check_service "$CU_NAME" "http://127.0.0.1:${HS_PORT}/health"

# Unread chat messages
UNREAD=$(curl -s --max-time 2 "http://127.0.0.1:${HUB_PORT}/api/chat?mode=unread" 2>/dev/null)
UNREAD_COUNT=$(echo "$UNREAD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('count',0))" 2>/dev/null || echo 0)
if [ "$UNREAD_COUNT" -gt 0 ] 2>/dev/null; then
    echo -e "\n\033[1;33mChat:\033[0m $UNREAD_COUNT unread message(s) — check with read_messages"
fi

# Pending reminders
PENDING=$(curl -s --max-time 2 "http://127.0.0.1:${NOTIF_PORT}/pending" 2>/dev/null)
PENDING_COUNT=$(echo "$PENDING" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo 0)
if [ "$PENDING_COUNT" -gt 0 ] 2>/dev/null; then
    echo -e "\033[1;33mReminders:\033[0m $PENDING_COUNT due"
fi

# Disk
DISK_USED=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')
echo -e "\n\033[0;34mDisk:\033[0m ${DISK_USED:-unknown}"

# KB stats
if [ -d "$KB_DIR" ]; then
    TOPIC_COUNT=$(find "$KB_DIR" -name "*.md" -not -path "*/contacts/*" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "\033[0;34mKnowledge:\033[0m $TOPIC_COUNT topics"
fi

# Due tasks
TASKS_FILE="$KB_DIR/tasks.md"
if [ -f "$TASKS_FILE" ]; then
    DUE_TASKS=$(python3 -c "
import re, sys
from datetime import datetime, timedelta
now = datetime.now()
freqs = {'6h': 0.25, '12h': 0.5, 'daily': 1, '2d': 2, '3d': 3, 'weekly': 7, 'monthly': 30}
due = []
for line in open('$TASKS_FILE'):
    m = re.match(r'- \[ \] (.+?) \| type: (\w+) \| freq: (\w+) \| last: (.+)', line.strip())
    if not m: continue
    desc, ttype, freq, last = m.groups()
    try:
        last_dt = datetime.strptime(last.strip(), '%Y-%m-%d %H:%M')
        days = freqs.get(freq, 1)
        if now - last_dt >= timedelta(days=days):
            due.append(desc.strip())
    except: pass
if due:
    print('\n\033[1;33mTasks due:\033[0m')
    for d in due[:5]: print(f'  • {d}')
else:
    print('\n\033[0;34mTasks:\033[0m nothing due')
" 2>/dev/null)
    [ -n "$DUE_TASKS" ] && echo "$DUE_TASKS"
fi

# Handoff
if [ -f "$HANDOFF_FILE" ]; then
    HANDOFF_LINES=$(wc -l < "$HANDOFF_FILE" | tr -d ' ')
    HANDOFF_MODIFIED=$(stat -f "%Sm" -t "%H:%M" "$HANDOFF_FILE" 2>/dev/null || stat -c "%y" "$HANDOFF_FILE" 2>/dev/null | cut -d' ' -f2 | cut -d: -f1-2)
    echo -e "\n\033[0;34mHandoff:\033[0m $HANDOFF_LINES lines, last updated $HANDOFF_MODIFIED"
    # Show main goal
    GOAL=$(sed -n '/## MAIN GOAL/,/^##[^#]/p' "$HANDOFF_FILE" | head -5)
    if [ -n "$GOAL" ]; then
        echo -e "\033[1;33m┌─ MAIN GOAL ─────────────────────────────────────────┐\033[0m"
        echo "$GOAL" | while IFS= read -r line; do
            echo -e "\033[1;33m│\033[0m $line"
        done
        echo -e "\033[1;33m└─────────────────────────────────────────────────────┘\033[0m"
    fi
fi

# Recent forum posts (last 24h)
FORUM_POSTS=$(curl -s --max-time 2 "http://127.0.0.1:${FORUM_PORT}/posts?limit=3&sort=recent" 2>/dev/null)
if [ -n "$FORUM_POSTS" ]; then
    FORUM_DISPLAY=$(echo "$FORUM_POSTS" | python3 -c "
import sys, json
try:
    posts = json.load(sys.stdin)
    if posts:
        print('\n\033[1;33mRecent forum posts:\033[0m')
        for p in posts[:3]:
            ccount = p.get('comment_count', 0)
            print(f'  [{p[\"id\"]}] {p[\"title\"]} ({ccount} comments)')
except: pass
" 2>/dev/null)
    [ -n "$FORUM_DISPLAY" ] && echo "$FORUM_DISPLAY"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
