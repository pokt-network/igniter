# Scenario 3: verifyTransaction — Tier 1 (RPC tx_index)

Verifies that the normal happy path still works: TX found via RPC tx_index.

## Pre-conditions
- [ ] Localnet running with tx_index enabled (default for localnet)
- [ ] Middleman and provider bootstrapped
- [ ] A wallet with funds connected to the middleman UI

## Steps

### 3.1 Initiate a Stake Transaction
- [ ] From the middleman UI, initiate a new supplier stake
- [ ] Sign the transaction with the wallet
- [ ] Note the transaction ID from the UI or DB

### 3.2 Monitor Workflow
- [ ] In Temporal UI, find the `ExecuteTransaction-<id>` workflow
- [ ] Watch the workflow progress through activities:
  1. `getTransaction` (gets TX from DB)
  2. `executeTransaction` (broadcasts to chain) — if TX has no hash yet
  3. `getBlockHeight`
  4. `waitForNextBlock`
  5. `verifyTransaction` ← this is the key step

### 3.3 Verify Tier 1 Succeeds
- [ ] Check middleman-workflows logs for the verifyTransaction call
- [ ] Should NOT see any "falling back to API" or "block scan" log messages
- [ ] Workflow should complete successfully

### 3.4 Verify DB Updated
```sql
SELECT id, status, "verificationHeight", "consumedFee" FROM transactions WHERE id = <tx_id>;
```
- [ ] `status` = `success`
- [ ] `verificationHeight` is set (block where verification happened)
- [ ] `consumedFee` is set (gas used)

### 3.5 Verify Provider Notified
- [ ] Check provider DB: the supplier key should be updated to `staked`
- [ ] Check Temporal for `notifyProviderOfStakedAddresses` activity completion

## Expected Result
Normal staking flow works end-to-end with Tier 1 RPC lookup.
