#!/bin/bash
# Auto-commit knowledge base changes
cd "$(dirname "$0")" 2>/dev/null || exit 0

if [ -z "$(git status --porcelain)" ]; then
    exit 0
fi

git add -A
git commit -m "Auto-commit KB changes" --no-gpg-sign 2>/dev/null
