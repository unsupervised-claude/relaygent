#!/bin/bash
# Enforce 200-line limit on all source files.
# Usage: ./scripts/check-file-length.sh [max_lines]
# Exit code 1 if any file exceeds the limit.

MAX_LINES="${1:-200}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
VIOLATIONS=0

check_file() {
    local file=$1
    local lines
    lines=$(wc -l < "$file")
    if [ "$lines" -gt "$MAX_LINES" ]; then
        rel="${file#$REPO_DIR/}"
        echo "FAIL: $rel ($lines lines, max $MAX_LINES)"
        VIOLATIONS=$((VIOLATIONS + 1))
    fi
}

is_source_file() {
    case "$1" in
        *.py|*.js|*.mjs|*.svelte|*.ts|*.sh|*.bash) return 0 ;;
    esac
    # Extensionless files: check for shebang (scripts in bin/, hooks/)
    case "$(basename "$1")" in
        *.*) return 1 ;;  # has extension but not a known source type
    esac
    head -c 2 "$1" 2>/dev/null | grep -q '#!' && return 0
    return 1
}

for dir in harness hub/src hooks notifications computer-use hammerspoon bin; do
    full_path="$REPO_DIR/$dir"
    [ -d "$full_path" ] || continue
    while IFS= read -r file; do
        is_source_file "$file" && check_file "$file"
    done < <(find "$full_path" -type f ! -path '*/node_modules/*' ! -path '*/.svelte-kit/*' ! -path '*/build/*' ! -path '*/.venv/*')
done

# Also check top-level scripts
for file in "$REPO_DIR"/setup.mjs "$REPO_DIR"/setup.sh "$REPO_DIR"/setup-helpers.mjs; do
    [ -f "$file" ] && check_file "$file"
done

if [ "$VIOLATIONS" -gt 0 ]; then
    echo ""
    echo "$VIOLATIONS file(s) exceed $MAX_LINES lines. Refactor before building."
    exit 1
fi
