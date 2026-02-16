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
        echo "  ✓ $name: \033[0;32mrunning\033[0m"
    else
        echo "  ✗ $name: \033[0;31mdown\033[0m"
    fi
}
check_service "Notifications" "http://127.0.0.1:${NOTIF_PORT}/health"
check_service "Forum" "http://127.0.0.1:${FORUM_PORT}/health"
check_service "Hub" "http://127.0.0.1:${HUB_PORT}/api/health"
HS_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_FILE')); print(c.get('services',{}).get('hammerspoon',{}).get('port',8097))" 2>/dev/null || echo 8097)
check_service "Hammerspoon" "http://127.0.0.1:${HS_PORT}/health"

# Disk
DISK_USED=$(df -h ~ 2>/dev/null | awk 'NR==2{print $5}')
echo -e "\n\033[0;34mDisk:\033[0m ${DISK_USED:-unknown}"

# KB stats
if [ -d "$KB_DIR" ]; then
    TOPIC_COUNT=$(find "$KB_DIR" -name "*.md" -not -path "*/contacts/*" 2>/dev/null | wc -l | tr -d ' ')
    echo -e "\033[0;34mKnowledge:\033[0m $TOPIC_COUNT topics"
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

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
