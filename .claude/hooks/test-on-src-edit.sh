#!/usr/bin/env bash
# PostToolUse: after editing an extension's src/*.ts, run that extension's own
# test script (tsc + node --test) and feed failures back to the agent.
input=$(cat)
file=$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty')
[ -z "$file" ] && exit 0
file="${file//\\//}"

case "$file" in
  */extensions/*/src/*.ts) ;;
  *) exit 0 ;;
esac

ext_dir=$(printf '%s' "$file" | grep -oE 'extensions/[^/]+' | head -1)
[ -z "$ext_dir" ] && exit 0

root="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null)}"
[ -z "$root" ] && exit 0
proj_dir="$root/$ext_dir"

[ -f "$proj_dir/package.json" ] || exit 0
grep -q '"test"[[:space:]]*:' "$proj_dir/package.json" || exit 0

output=$(cd "$proj_dir" && npm test 2>&1)
status=$?

if [ "$status" -ne 0 ]; then
  jq -n --arg dir "$ext_dir" --arg out "$output" \
    '{decision:"block", reason: ("npm test failed in " + $dir + " after this edit:\n\n" + $out)}'
fi
exit 0
