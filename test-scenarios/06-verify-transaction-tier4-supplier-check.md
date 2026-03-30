# Scenario 6: verifyTransaction — Tier 4 (Supplier Existence Check)

Verifies that when all TX lookup methods fail (tiers 1-3), the system checks if the supplier exists on-chain to close the loop.

## Pre-conditions
- [ ] A pending TX in middleman DB with a hash that can't be found anywhere
- [ ] The supplier IS staked on-chain (staked via different path, e.g. provider remediation)
- [ ] OR: The supplier is NOT staked on-chain (TX was truly lost/rejected)

## Case A: Supplier EXISTS on-chain (mark as success)

### 6A.1 Setup
```sql
-- Insert a TX that can't be found (fake hash, old height)
-- Link it to a node whose address IS a real staked supplier
```
- [ ] Verify supplier exists: query chain for the operator address

### 6A.2 Trigger Workflow
- [ ] Let `ExecutePendingTransactions` pick up the TX
- [ ] Or trigger `ExecuteTransaction` workflow manually via Temporal

### 6A.3 Verify Fallback Chain
Check logs for progression through all tiers:
- [ ] Log: "RPC getTx returned null" (Tier 1 failed)
- [ ] Log: "REST API fallback failed" or "API returned 404" (Tier 2 failed)
- [ ] Log: "Block scan did not find TX in 30 blocks" (Tier 3 failed)
- [ ] Log: "TX not found via any method, checking supplier state"
- [ ] Log: "Supplier exists on-chain, marking TX as success"

### 6A.4 Verify DB
```sql
SELECT status, "verificationHeight" FROM transactions WHERE id = <tx_id>;
```
- [ ] `status` = `success`
- [ ] Workflow completed (not retrying)

### 6A.5 Verify Provider Notification
- [ ] `notifyProviderOfStakedAddresses` was called
- [ ] Provider key updated to `staked`

---

## Case B: Supplier DOES NOT exist on-chain (mark as failure)

### 6B.1 Setup
```sql
-- Insert a TX with a fake hash and operator address that is NOT staked
```

### 6B.2 Trigger Workflow
- [ ] Same as 6A.2

### 6B.3 Verify Fallback Chain
- [ ] Tiers 1-3 fail (same logs as above)
- [ ] Log: "Supplier not found on-chain, marking TX as failure"

### 6B.4 Verify DB
```sql
SELECT status FROM transactions WHERE id = <tx_id>;
```
- [ ] `status` = `failure`
- [ ] Workflow completed (not retrying)

### 6B.5 Verify Provider Notification
- [ ] `notifyProviderOfFailedStakes` was called
- [ ] Provider key updated appropriately

---

## Case C: No operator address available (throw error, retry)

### 6C.1 Setup
- [ ] TX with no linked nodes / no operator address extractable

### 6C.2 Verify Behavior
- [ ] Tiers 1-3 fail
- [ ] Tier 4 skipped (no operator address)
- [ ] Error thrown: "Transaction data is incomplete or not found"
- [ ] Workflow retries (existing retry policy)
- [ ] After max retries → workflow fails

## Expected Result
Tier 4 acts as a circuit breaker: supplier exists = success, doesn't exist = failure. No infinite loops.
