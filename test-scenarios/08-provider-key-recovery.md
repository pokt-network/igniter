# Scenario 8: Provider Key Recovery — Release Stale Delivered Keys

Verifies that provider keys stuck in "delivered" state for >24h are recovered.

## Pre-conditions
- [ ] Provider deployed with new code
- [ ] Keys exist in various states in the provider DB
- [ ] Access to provider DB and Temporal

## Case A: Delivered key, supplier IS staked on-chain

### 8A.1 Setup
```sql
-- Find or create a key in 'delivered' state with deliveredAt > 24h ago
-- The supplier address must be actually staked on-chain
UPDATE keys SET status = 'delivered', "deliveredAt" = NOW() - INTERVAL '25 hours'
WHERE address = '<address_of_staked_supplier>';
```

### 8A.2 Wait for Recovery Workflow
- [ ] Check Temporal for `ImportSupplierRecovery` (or new `DeliveredKeyRecovery`) workflow
- [ ] The scheduled workflow should detect this stale key

### 8A.3 Verify Recovery
- [ ] Workflow queries chain: supplier exists → key should be updated to `staked`
```sql
SELECT address, status, "deliveredAt" FROM keys WHERE address = '<address>';
```
- [ ] `status` = `staked` (not `delivered` anymore)
- [ ] Log: "Recovered stale delivered key — supplier is staked on-chain"

---

## Case B: Delivered key, supplier NOT staked on-chain

### 8B.1 Setup
```sql
-- Create a key in 'delivered' state with deliveredAt > 24h ago
-- The supplier address is NOT staked on-chain (staking failed or never happened)
UPDATE keys SET status = 'delivered', "deliveredAt" = NOW() - INTERVAL '25 hours'
WHERE address = '<address_not_staked>';
```

### 8B.2 Wait for Recovery Workflow
- [ ] Recovery workflow detects the stale key

### 8B.3 Verify Recovery
- [ ] Workflow queries chain: supplier NOT found → key returned to `available`
```sql
SELECT address, status FROM keys WHERE address = '<address>';
```
- [ ] `status` = `available` (ready to be re-assigned)
- [ ] Log: "Recovered stale delivered key — supplier not staked, returning to available"

---

## Case C: Delivered key, less than 24h old (should NOT be recovered)

### 8C.1 Setup
```sql
UPDATE keys SET status = 'delivered', "deliveredAt" = NOW() - INTERVAL '12 hours'
WHERE address = '<any_address>';
```

### 8C.2 Verify No Recovery
- [ ] Recovery workflow runs but skips this key (too recent)
- [ ] Key remains in `delivered` state
- [ ] No logs about recovering this specific key

---

## Case D: Coordination with middleman TX expiration

This verifies that Phase 8 (middleman TX expiration) and Phase 9 (provider key recovery) don't conflict.

### 8D.1 Timeline Verification
- [ ] Middleman expires TXs after ~30 blocks (~30 min)
- [ ] Provider recovers keys after 24 hours
- [ ] There's a >23 hour gap between middleman giving up and provider recovering
- [ ] During this gap: middleman has already notified provider of failure
- [ ] Verify: if middleman notified failure, provider key should already be updated (not waiting 24h)

### 8D.2 Simulate Full Flow
1. [ ] Initiate a stake from middleman
2. [ ] Kill the middleman-workflows worker before it can verify the TX
3. [ ] Wait for the TX to expire (or manually set old executionHeight)
4. [ ] Restart middleman-workflows
5. [ ] Verify: TX marked as failed, provider notified
6. [ ] Verify: provider key goes to appropriate state
7. [ ] If notification failed: after 24h, recovery workflow catches it

## Expected Result
Stale delivered keys are recovered based on actual on-chain state. Recent keys are left alone. No conflict with middleman TX handling.
