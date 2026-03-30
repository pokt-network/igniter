# Scenario 7: TX Expiration — Prevent Stale TX Execution

Verifies that transactions older than 30 blocks are not executed and are marked as failed.

## Pre-conditions
- [ ] Middleman deployed with new code
- [ ] Access to DB and Temporal

## Case A: TX with hash, expired (broadcast succeeded but never verified)

### 7A.1 Setup
```sql
-- Insert an old pending TX with a hash (was broadcast but never verified)
INSERT INTO transactions (hash, type, status, "executionHeight", "fromAddress", "signedPayload", "unsignedPayload", "estimatedFee", "providerFee", "typeProviderFee", "providerId", "createdAt", "updatedAt", "createdBy")
VALUES (
  'DEADBEEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF12345678',
  'Stake', 'pending',
  (SELECT max_height - 100 FROM (SELECT MAX("executionHeight") as max_height FROM transactions) t), -- 100 blocks ago
  -- ... fill other required fields
);
```
- [ ] Verify TX `executionHeight` is > 30 blocks behind current height

### 7A.2 Trigger Workflow
- [ ] Let `ExecutePendingTransactions` pick it up

### 7A.3 Verify Behavior
- [ ] Workflow detects TX is expired (> 30 blocks old)
- [ ] Goes directly to `verifyTransaction` with Tier 4 (supplier check)
- [ ] Does NOT attempt `waitForNextBlock` (unnecessary for old TXs)
- [ ] Log: "TX expired, skipping to verification"

### 7A.4 Verify Outcome
- [ ] TX is marked as either `success` (supplier exists) or `failure` (doesn't)
- [ ] Workflow completes — no infinite retry

---

## Case B: TX without hash, expired (never broadcast)

### 7B.1 Setup
```sql
-- Insert an old pending TX WITHOUT a hash (was never broadcast)
INSERT INTO transactions (hash, type, status, "executionHeight", ...)
VALUES (NULL, 'Stake', 'pending', <old_height>, ...);
```

### 7B.2 Trigger Workflow
- [ ] Let `ExecutePendingTransactions` pick it up

### 7B.3 Verify Behavior
- [ ] Workflow detects TX has no hash AND is expired
- [ ] Immediately marks as `failure` with log: "TX expired before broadcast"
- [ ] Does NOT attempt to broadcast (prevents stale TX execution)
- [ ] Calls `notifyProviderOfFailedStakes`

### 7B.4 Verify DB
```sql
SELECT status, log FROM transactions WHERE id = <tx_id>;
```
- [ ] `status` = `failure`
- [ ] `log` = "TX expired before broadcast"

---

## Case C: Fresh TX (not expired) — normal flow

### 7C.1 Verify Normal Path
- [ ] Initiate a new stake via UI
- [ ] TX is within 30 blocks → normal flow (broadcast, wait, verify via Tier 1)
- [ ] No expiration logic triggered
- [ ] TX completes as `success` or `failure` normally

## Expected Result
Expired TXs are caught early and resolved, preventing both infinite loops and stale broadcasts.
