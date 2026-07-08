#!/usr/bin/env bash
# Hard gate: zero unsanctioned `console.*` calls in migrated paths (spec §11).
# ESLint cannot gate (only-warn downgrades everything), so we grep.
#
# DEFAULT-SAFE (Otto#9): scans EVERY apps/*/src and packages/*/src, minus an
# explicit EXCLUSIONS list. New source is covered automatically — a path must
# be opted OUT (in no-console-exclusions.txt), never opted in. The inverse of
# the old allowlist, which silently ignored any path nobody remembered to add.
#
# Uses POSIX grep (always present, no CI install step needed) instead of
# ripgrep. Exit codes are handled explicitly (NOT `set -e`) because grep's
# exit code is meaningful: 0 = matches found (guard must inspect/fail), 1 = no
# matches (clean), >=2 = grep itself errored (fail loudly, do not treat as
# clean).
set -uo pipefail

# Run from repo root so the apps/*/src, packages/*/src globs resolve.
cd "$(dirname "$0")/.." || exit 2

EXCLUSIONS_FILE="scripts/no-console-exclusions.txt"
# Call-shape only: requires an opening paren, so it won't match prose
# mentions of "console." in comments/docs.
PATTERN='console\.(log|error|warn|info|debug|trace)[[:space:]]*\('

# Scan roots: every app + package source dir.
roots=()
for d in apps/*/src packages/*/src; do
  [ -d "$d" ] && roots+=("$d")
done
if [ "${#roots[@]}" -eq 0 ]; then
  echo "::error::no-console guard: found no apps/*/src or packages/*/src roots to scan"
  exit 2
fi

# Fixed-string path-prefix excludes (blank / #-comment lines skipped).
excludes=()
if [ -f "$EXCLUSIONS_FILE" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    case "$line" in \#*) continue ;; esac
    excludes+=("$line")
  done < "$EXCLUSIONS_FILE"
fi

hits=$(grep -rEn \
  --include='*.ts' --include='*.tsx' \
  --exclude='*.test.ts' --exclude='*.test.tsx' \
  "$PATTERN" "${roots[@]}" 2>&1)
rc=$?

case "$rc" in
  0)
    : # matches found — filter excluded paths below
    ;;
  1)
    echo "no-console guard: OK (no console.* in scanned source)"
    exit 0
    ;;
  *)
    echo "::error::grep failed (exit $rc) — guard cannot verify, failing loudly"
    echo "$hits"
    exit 2
    ;;
esac

# Drop lines under an excluded path prefix.
if [ "${#excludes[@]}" -gt 0 ]; then
  hits=$(printf '%s\n' "$hits" | grep -vFf <(printf '%s\n' "${excludes[@]}"))
fi

if [ -z "$hits" ]; then
  echo "no-console guard: OK (all console.* are in excluded paths)"
  exit 0
fi

echo "::error::Unsanctioned console.* found:"
echo "$hits"
exit 1
