# Scenario 9: End-to-End — Reproduce and Fix the Ajes Case

Verifies that the exact production bug (TX F7D3CF2B stuck in pending) is resolved.

## Context
- TX hash: `F7D3CF2B836A566C36BD47BB331A04A25B5988710A00552F75B21A1C425EB7A3`
- Supplier: `pokt1anp2p8zkxcf60xktmw0rsuwwvxx4a9ye82lrzf`
- Confirmed on-chain at height 680013 (code 0, gas_used 142622)
- ExecutionHeight in DB: 680011
- Node status in DB: `staked`
- TX status in DB: `pending` (stuck since March 19)
- RPC nodes don't have this TX in tx_index
- REST API also returns 404 for this TX

## Steps

### 9.1 Deploy New Code to Staging
- [ ] Deploy middleman-workflows with the new 4-tier verifyTransaction
- [ ] Verify `pocketApiUrl` and `pocketRpcUrl` are set in DB

### 9.2 Monitor the Existing Stuck TX
- [ ] The `ExecutePendingTransactions` scheduled workflow will pick up TX 57
- [ ] Watch the `ExecuteTransaction-57` workflow in Temporal UI

### 9.3 Verify Tier Progression
Check logs for:
- [ ] Tier 1: "RPC getTx returned null for F7D3CF2B..." (expected — tx_index doesn't have it)
- [ ] Tier 2: "REST API returned 404 for F7D3CF2B..." (expected — same index)
- [ ] Tier 3: Block scan from height 680011 to 680041
  - [ ] If TX found at height 680013: success! code=0, gasUsed=142622
  - [ ] If block scan also fails (blocks pruned): proceed to Tier 4
- [ ] Tier 4 (if needed): "Checking supplier state for pokt1anp2p8..."
  - [ ] Supplier exists on-chain → "Supplier exists, marking TX as success"

### 9.4 Verify Final State
```sql
SELECT id, status, "verificationHeight", "consumedFee" FROM transactions WHERE id = 57;
```
- [ ] `status` = `success`
- [ ] Workflow completed — no more retries

### 9.5 Verify Temporal
- [ ] `ExecuteTransaction-57` workflow shows as Completed (not Failed/Running)
- [ ] No new instances of this workflow are being spawned

### 9.6 Verify UI
- [ ] Open middleman client UI for Ajes' wallet
- [ ] Transaction should show as "Success" (not "Pending")

## Expected Result
The stuck TX is resolved automatically through the fallback chain. The infinite retry loop is broken.
