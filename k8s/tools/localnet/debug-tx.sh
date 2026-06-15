#!/usr/bin/env bash
# One-shot e2e debug snapshot for the canonical tx broadcast lifecycle (localnet).
# Usage: bash k8s/tools/localnet/debug-tx.sh [provider|middleman] [worker-log-seconds]
# Prints: tx-by-status, tx detail, keys-by-state, recent worker errors, and the
# REAL cause of the latest failed activity (from Temporal history, not the opaque
# workflow warn). Designed to be read by a verifier agent so the main thread stays lean.
set -uo pipefail
DB="${1:-provider}"
SECS="${2:-120}"
NS="$DB"

PGPOD=$(kubectl get pods 2>/dev/null | grep '^postgresql-0' | awk '{print $1}')
PW=$(kubectl get secret postgresql -o jsonpath='{.data.postgres-password}' 2>/dev/null | base64 -d 2>/dev/null)
Q(){ kubectl exec "$PGPOD" -- bash -c "PGPASSWORD='$PW' psql -U postgres -d $DB -tAc \"$1\"" 2>/dev/null; }
WPOD=$(kubectl get pods 2>/dev/null | grep "^${DB}-workflows" | awk '{print $1}' | head -1)
ADM=$(kubectl get pods 2>/dev/null | grep temporal-admintools | awk '{print $1}')

echo "### TX BY STATUS ($DB)"
Q "select status, type, count(*) from transactions group by 1,2 order by 1,2"
echo "### TX DETAIL (last 10)"
Q "select id, status, (hash is not null) hh, (signed_payload is not null) sp, code, left(coalesce(message,''),50) msg from transactions order by id desc limit 10"
echo "### KEYS BY STATE"
Q "select state, count(*) from keys group by 1 order by 2 desc"
echo "### WORKER ERRORS (last ${SECS}s, deduped)"
kubectl logs "$WPOD" --since="${SECS}s" 2>/dev/null \
  | grep -iE "verification failed|Activity task failed|error|reject|throw" \
  | grep -ivE "No keys found" | sed -E 's/[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]+//' \
  | sort | uniq -c | sort -rn | head -8
echo "### LATEST FAILED ACTIVITY CAUSE (Temporal history)"
RID=$(kubectl logs "$WPOD" --since="${SECS}s" 2>/dev/null | grep -oE 'runId: "[0-9a-f-]+"' | tail -1 | sed -E 's/.*"([0-9a-f-]+)".*/\1/')
WID=$(kubectl logs "$WPOD" --since="${SECS}s" 2>/dev/null | grep -oE 'workflowId: "[^"]+"' | grep -iE "Verify|Execute" | tail -1 | sed -E 's/.*"([^"]+)".*/\1/')
if [ -n "${WID:-}" ] && [ -n "${RID:-}" ]; then
  kubectl exec "$ADM" -- temporal workflow show --workflow-id "$WID" --run-id "$RID" \
    --namespace "$NS" --address temporal-frontend:7233 --output json 2>/dev/null \
  | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin);
  for e in d.get('events',[]):
    if e.get('eventType')=='EVENT_TYPE_ACTIVITY_TASK_FAILED':
      f=e.get('activityTaskFailedEventAttributes',{}).get('failure',{})
      print('  msg:', f.get('message','')[:300]); break
  else: print('  (no failed activity in', WID,')')
except Exception as ex: print('  parse-err', ex)
" 2>/dev/null
else echo "  (no recent Verify/Execute workflow runId found)"; fi
