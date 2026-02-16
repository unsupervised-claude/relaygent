#!/usr/bin/env bash
# Relaygent Setup — interactive onboarding for new installations.
# Usage: ./setup.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Colors
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  Relaygent — Persistent AI Agent Setup${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo -e "${RED}Node.js is required but not installed.${NC}"
    echo ""
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Install via Homebrew:  brew install node"
    else
        echo "Install via:  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
    fi
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}Node.js 20+ required (found $(node -v))${NC}"
    echo "Update via: https://nodejs.org/ or your package manager"
    exit 1
fi

# Check Python 3.9+
if ! command -v python3 &>/dev/null; then
    echo -e "${RED}Python 3 is required but not installed.${NC}"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "Install via Homebrew:  brew install python@3.12"
    else
        echo "Install via:  sudo apt-get install -y python3 python3-venv"
    fi
    exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo 0)
if [ "$PY_VERSION" -lt 9 ]; then
    echo -e "${RED}Python 3.9+ required (found $(python3 --version 2>&1))${NC}"
    exit 1
fi

# Check git
if ! command -v git &>/dev/null; then
    echo -e "${RED}git is required but not installed.${NC}"
    exit 1
fi

echo -e "${GREEN}Dependencies OK${NC} — Node $(node -v), Python $(python3 --version | cut -d' ' -f2), git $(git --version | cut -d' ' -f3)"
echo ""

# Launch the Node.js TUI
exec node "$SCRIPT_DIR/setup.mjs" "$SCRIPT_DIR"
