#!/usr/bin/env bash
# Relaygent Docker entrypoint — starts all services and the relay harness.
set -euo pipefail

REPO_DIR="/app"
CONFIG_DIR="$HOME/.relaygent"
CONFIG_FILE="$CONFIG_DIR/config.json"

HUB_PORT="${RELAYGENT_HUB_PORT:-8080}"
FORUM_PORT="${RELAYGENT_FORUM_PORT:-8085}"
NOTIF_PORT="${RELAYGENT_NOTIFICATIONS_PORT:-8083}"
CU_PORT="${HAMMERSPOON_PORT:-8097}"

# In Docker, services must bind to 0.0.0.0 to be reachable from outside
export RELAYGENT_BIND_HOST="${RELAYGENT_BIND_HOST:-0.0.0.0}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

write_config() {
    mkdir -p "$CONFIG_DIR"
    cat > "$CONFIG_FILE" <<CONF
{
  "agent": { "name": "${RELAYGENT_AGENT_NAME:-relaygent}" },
  "hub": { "port": $HUB_PORT },
  "services": {
    "notifications": { "port": $NOTIF_PORT },
    "forum": { "port": $FORUM_PORT },
    "hammerspoon": { "port": $CU_PORT }
  },
  "paths": {
    "repo": "$REPO_DIR",
    "kb": "$REPO_DIR/knowledge/topics",
    "logs": "$REPO_DIR/logs",
    "data": "$REPO_DIR/data"
  },
  "created": "$(date -Iseconds)"
}
CONF
}

setup_hooks() {
    local check_notif="$REPO_DIR/hooks/check-notifications"
    local project_hash; project_hash=$(echo -n "$REPO_DIR" | tr '/' '-')
    local settings_dir="$HOME/.claude/projects/$project_hash"
    mkdir -p "$settings_dir"

    cat > "$settings_dir/settings.json" <<SETTINGS
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "*",
      "hooks": [{ "type": "command", "command": "$check_notif" }]
    }]
  }
}
SETTINGS
    cp "$settings_dir/settings.json" "$REPO_DIR/harness/settings.json"

    # Register MCP servers
    local claude_json="$HOME/.claude.json"
    node -e "
const fs = require('fs');
const p = '$REPO_DIR';
let c = {};
try { c = JSON.parse(fs.readFileSync('$claude_json','utf-8')); } catch {}
c.mcpServers = {
  'hub-chat': { command:'node', args:['$REPO_DIR/hub/mcp-chat.mjs'], env:{HUB_PORT:'$HUB_PORT'} },
  'relaygent-notifications': { command:'node', args:['$REPO_DIR/notifications/mcp-server.mjs'], env:{RELAYGENT_NOTIFICATIONS_PORT:'$NOTIF_PORT'} },
  'computer-use': { command:'node', args:['$REPO_DIR/computer-use/mcp-server.mjs'], env:{HAMMERSPOON_PORT:'$CU_PORT'} },
  'secrets': { command:'node', args:['$REPO_DIR/secrets/mcp-server.mjs'] },
  'email': { command:'node', args:['$REPO_DIR/email/mcp-server.mjs'] },
  'slack': { command:'node', args:['$REPO_DIR/slack/mcp-server.mjs'] },
};
fs.writeFileSync('$claude_json', JSON.stringify(c, null, 2));
"
}

start_services() {
    mkdir -p "$REPO_DIR/logs"

    # Start Xvfb for headless computer-use
    if [ -z "${DISPLAY:-}" ]; then
        export DISPLAY=:99
        Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp &
        echo -e "  Xvfb: ${GREEN}started${NC} (DISPLAY=$DISPLAY)"
        sleep 0.5
    fi

    # Computer-use (Linux backend)
    DISPLAY="${DISPLAY}" python3 "$REPO_DIR/computer-use/linux-server.py" \
        > "$REPO_DIR/logs/relaygent-computer-use.log" 2>&1 &
    echo -e "  Computer-use (port $CU_PORT): ${GREEN}started${NC}"

    # Hub
    PORT="$HUB_PORT" node "$REPO_DIR/hub/server.js" \
        > "$REPO_DIR/logs/relaygent-hub.log" 2>&1 &
    echo -e "  Hub (port $HUB_PORT): ${GREEN}started${NC}"

    # Forum
    "$REPO_DIR/forum/.venv/bin/python3" "$REPO_DIR/forum/server.py" \
        > "$REPO_DIR/logs/relaygent-forum.log" 2>&1 &
    echo -e "  Forum (port $FORUM_PORT): ${GREEN}started${NC}"

    # Notifications
    "$REPO_DIR/notifications/.venv/bin/python3" "$REPO_DIR/notifications/server.py" \
        > "$REPO_DIR/logs/relaygent-notifications.log" 2>&1 &
    echo -e "  Notifications (port $NOTIF_PORT): ${GREEN}started${NC}"

    # Notification poller (caches notifications for check-notifications hook)
    "$REPO_DIR/hooks/notification-poller" \
        > "$REPO_DIR/logs/relaygent-notification-poller.log" 2>&1 &
    echo -e "  Notification poller: ${GREEN}started${NC}"

    sleep 1
}

do_start() {
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  Relaygent (Docker)${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # Verify Claude CLI auth
    if ! claude -p 'hi' >/dev/null 2>&1; then
        echo -e "${RED}Claude CLI not authenticated.${NC}"
        echo -e "Mount your Claude credentials into the container:"
        echo -e "  ${YELLOW}volumes: ['~/.claude:/root/.claude:ro']${NC}"
        echo -e "Or run ${YELLOW}claude${NC} interactively first."
        exit 1
    fi
    echo -e "  Claude CLI: ${GREEN}authenticated${NC}"

    write_config
    setup_hooks
    start_services

    echo -e "\n  Dashboard: ${CYAN}http://localhost:$HUB_PORT/${NC}"
    echo -e "  Logs: $REPO_DIR/logs/\n"

    # Start relay harness (foreground — keeps container alive)
    echo -e "${CYAN}Starting relay harness...${NC}"
    exec python3 "$REPO_DIR/harness/relay.py"
}

case "${1:-start}" in
    start) do_start ;;
    shell) exec /bin/bash ;;
    hub-only)
        write_config
        PORT="$HUB_PORT" HOST="0.0.0.0" exec node "$REPO_DIR/hub/server.js"
        ;;
    *) echo "Usage: docker run relaygent [start|shell|hub-only]"; exit 1 ;;
esac
