#!/usr/bin/env bash
# Bootstrap Claude credentials into the relaygent Docker volume from your Mac.
#
# Claude stores OAuth tokens in the macOS Keychain — Docker containers can't
# access that. This script extracts the token and writes it to the persistent
# relaygent-claude volume so the container can authenticate.
#
# Run once before starting the container:
#   ./scripts/docker-auth.sh
#   docker compose up -d
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

if [[ "$(uname)" != "Darwin" ]]; then
    echo -e "${RED}This script is for macOS only.${NC}"
    echo -e "On Linux, set ${YELLOW}ANTHROPIC_API_KEY${NC} in docker-compose.yml instead."
    exit 1
fi

echo -e "${CYAN}Bootstrapping Claude credentials from macOS Keychain...${NC}"

CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)

if [ -z "$CREDS" ]; then
    echo -e "${RED}Claude credentials not found in Keychain.${NC}"
    echo -e "Make sure you've authenticated on this Mac first: run ${YELLOW}claude${NC} and log in."
    exit 1
fi

# Check if the access token is expired and refresh it via the host Claude CLI if so.
EXPIRES_AT=$(python3 -c "
import json, sys
try:
    print(json.loads(sys.stdin.read()).get('claudeAiOauth', {}).get('expiresAt', 0))
except Exception:
    print(0)
" <<< "$CREDS")
NOW_MS=$(python3 -c "import time; print(int(time.time() * 1000))")

if [ "${EXPIRES_AT:-0}" -le "$NOW_MS" ] 2>/dev/null; then
    echo -e "${YELLOW}Access token expired — refreshing via host Claude CLI...${NC}"
    claude -p 'hi' >/dev/null 2>&1 || true
    # Re-extract the freshly-refreshed credentials
    CREDS=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null || true)
    if [ -z "$CREDS" ]; then
        echo -e "${RED}Still no credentials after refresh attempt. Run ${YELLOW}claude${NC}${RED} and log in, then retry.${NC}"
        exit 1
    fi
fi

# Pipe credentials via stdin — avoids exposing them in process args.
# Run as root so we can write to the (initially root-owned) named volume,
# then hand ownership to the agent user.
printf '%s' "$CREDS" | docker compose run --rm -T --user root --entrypoint bash relaygent \
    -c "mkdir -p /home/agent/.claude \
        && cat > /home/agent/.claude/.credentials.json \
        && chmod 600 /home/agent/.claude/.credentials.json \
        && chown -R agent:agent /home/agent/.claude \
        && echo 'ok'"

echo -e "${GREEN}Credentials saved to Docker volume.${NC}"
echo -e "Now start the container: ${CYAN}docker compose up -d${NC}"
