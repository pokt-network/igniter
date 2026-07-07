#!/usr/bin/env bash
# Hard gate: zero unsanctioned `console.` in migrated paths (spec §11).
# ESLint cannot gate (only-warn downgrades everything), so we grep.
set -euo pipefail

ALLOWLIST_FILE="$(dirname "$0")/no-console-allowlist.txt"
status=0

while IFS= read -r path; do
  [ -z "$path" ] && continue
  # Exclude test files and sanctioned writer sites inside packages/logger/src.
  hits="$(rg -n --glob '!**/*.test.ts' --glob '!**/__sanctioned__/**' 'console\.' "$path" || true)"
  if [ -n "$hits" ]; then
    echo "::error::Unsanctioned console.* found under $path:"
    echo "$hits"
    status=1
  fi
done < "$ALLOWLIST_FILE"

if [ "$status" -eq 0 ]; then
  echo "no-console guard: OK (allowlist clean)"
fi
exit "$status"
