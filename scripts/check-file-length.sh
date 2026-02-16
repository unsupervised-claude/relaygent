#!/bin/bash
# Enforce 200-line limit on all source files.
# Usage: ./scripts/check-file-length.sh [max_lines]
# Exit code 1 if any file exceeds the limit.

MAX_LINES="${1:-200}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
VIOLATIONS=0

for dir in harness hub/src hooks notifications forum computer-use hammerspoon; do
    full_path="$REPO_DIR/$dir"
    [ -d "$full_path" ] || continue
    while IFS= read -r file; do
        lines=$(wc -l < "$file")
        if [ "$lines" -gt "$MAX_LINES" ]; then
            rel="${file#$REPO_DIR/}"
            echo "FAIL: $rel ($lines lines, max $MAX_LINES)"
            VIOLATIONS=$((VIOLATIONS + 1))
        fi
    done < <(find "$full_path" -type f \( -name '*.py' -o -name '*.js' -o -name '*.mjs' -o -name '*.svelte' -o -name '*.ts' \) ! -path '*/node_modules/*' ! -path '*/.svelte-kit/*' ! -path '*/build/*' ! -path '*/.venv/*')
done

# Also check top-level scripts
for file in "$REPO_DIR"/setup.mjs "$REPO_DIR"/setup.sh "$REPO_DIR"/setup-helpers.mjs; do
    [ -f "$file" ] || continue
    lines=$(wc -l < "$file")
    if [ "$lines" -gt "$MAX_LINES" ]; then
        rel="${file#$REPO_DIR/}"
        echo "FAIL: $rel ($lines lines, max $MAX_LINES)"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
done

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "$VIOLATIONS file(s) exceed $MAX_LINES lines. Refactor before building."
    exit 1
fi
