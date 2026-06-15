# Canonical TX Broadcast — provider deploy (one-time)

Provider switches to the canonical lifecycle (parent INTENT → dispatcher sweep → per-tx
`ExecuteTransaction` child → verify sweep) + cosmos **unordered** txs. The #308 WAL is removed.

## Steps

1. **Pause** provider remediation schedules: `SupplierRemediation`, `SupplierInitialStake`,
   `SupplierAddressGroupMigration` (Temporal UI or `temporal schedule toggle --schedule-id <id> --pause`).
2. **Drain** in-flight `remediateSupplier` activities — short; wait ~2 min or until none Running.
3. **Pre-mark stale WAL rows BEFORE new workers start** (replaces the deleted `expireStaleBroadcasts`):
   ```sql
   UPDATE transactions
   SET status = 'failure', message = 'superseded by canonical-lifecycle migration'
   WHERE status = 'pending' AND hash IS NULL AND created_at < now() - interval '5 minutes';
   ```
   Hash-bearing pending rows are KEPT — the new `VerifyPendingTransactions` sweeper finishes them.
4. **Run migration 0020** (adds `signed_payload`, `timeout_timestamp`, `params`, `reasons`) before workers start.
5. **Deploy workers** — provider gains `ExecuteTransaction` + `ExecutePendingTransactions` (10s, `SCHEDULE_EXECUTE_PENDING_TX_INTERVAL`, `ScheduleOverlapPolicy.SKIP`).
6. **Unpause** the remediation schedules.

## Why this is safe

- No Temporal `patch()` needed — provider `ExecuteTransaction` is brand new (no in-flight history to replay against changed code). Middleman is untouched in mechanism.
- Recovery is total: remediation re-detects any still-needed stake and creates a fresh INTENT row.
- Double-broadcast is impossible: `UNIQUE(key_id) WHERE pending` (one pending tx per key) + Temporal `workflowId=ExecuteTransaction-${txId}` dedup + sign&persist-before-broadcast (re-broadcast replays identical bytes → cosmos unordered `(timeoutTimestamp.UnixNano(), sender)` dedup).
- Unordered failure verdict uses **chain block time** vs `timeout_timestamp` (9-min window), never verifier wall-clock — no clock-skew split-brain.

## Rollback

Revert the provider-workflows + db commits and redeploy. Pending INTENT rows (hash=null) are
harmless to the old code only if the old WAL columns still exist — prefer rolling forward; if
rollback is required, also `UPDATE transactions SET status='failure' WHERE status='pending' AND hash IS NULL`.
