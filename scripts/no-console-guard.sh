#!/usr/bin/env bash
# Hard gate: zero unsanctioned `console.*` calls in migrated paths (spec §11).
# ESLint cannot gate (only-warn downgrades everything), so we grep.
#
# Uses POSIX grep (always present, no CI install step needed) instead of
# ripgrep. Exit codes are handled explicitly (NOT `set -e`) because grep's
# exit code is meaningful: 0 = matches found (guard must fail), 1 = no
# matches (clean), >=2 = grep itself errored (fail loudly, do not treat as
# clean).
set -uo pipefail

ALLOWLIST_FILE="$(dirname "$0")/no-console-allowlist.txt"
# Call-shape only: requires an opening paren, so it won't match prose
# mentions of "console." in comments/docs.
PATTERN='console\.(log|error|warn|info|debug|trace)[[:space:]]*\('
status=0

while IFS= read -r path; do
  [ -z "$path" ] && continue
  # Exclude test files; only scan .ts/.tsx source.
  hits=$(grep -rEn \
    --include='*.ts' --include='*.tsx' \
    --exclude='*.test.ts' --exclude='*.test.tsx' \
    "$PATTERN" "$path" 2>&1)
  rc=$?
  case "$rc" in
    0)
      echo "::error::Unsanctioned console.* found under $path:"
      echo "$hits"
      status=1
      ;;
    1)
      : # no matches under this path — clean
      ;;
    *)
      echo "::error::grep failed (exit $rc) scanning $path — guard cannot verify, failing loudly"
      echo "$hits"
      exit 2
      ;;
  esac
done < "$ALLOWLIST_FILE"

if [ "$status" -eq 0 ]; then
  echo "no-console guard: OK (allowlist clean)"
fi
exit "$status"
