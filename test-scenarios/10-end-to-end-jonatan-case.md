# Scenario 10: End-to-End — Reproduce and Fix the JonatanM Case

Verifies that the Case 2 bug (supplier delivered but no TX in middleman) is resolved.

## Context
- Supplier: `pokt1xmynllqt99jsef392sut3lwprsf9yhq86n0nr4`
- Provider side: key shows as "Delivered" to "Pocket Staking", deliveredAt 2026-03-30
- Middleman side: NO record of this supplier or any TX for it
- On-chain: supplier does NOT exist (404 from Sauron API)
- Likely scenario: staking was initiated from provider, key was delivered to middleman,
  but the TX was never created or was lost. Middleman never processed it.

## Steps

### 10.1 Verify Current State in Provider DB
```sql
-- Check the key state
SELECT address, status, "deliveredAt", "deliveredTo" FROM keys
WHERE address LIKE '%xmyn%';
```
- [ ] Status is `delivered`
- [ ] deliveredAt is > 24h ago (by the time we test)

### 10.2 Wait for Key Recovery Workflow
- [ ] The `DeliveredKeyRecovery` (or extended `ImportSupplierRecovery`) workflow runs
- [ ] It detects this key as stale (delivered > 24h)

### 10.3 Verify On-Chain Check
- [ ] Workflow queries chain for supplier `pokt1xmynllqt99jsef392sut3lwprsf9yhq86n0nr4`
- [ ] Supplier does NOT exist on-chain → key should go back to `available`

### 10.4 Verify Provider DB Updated
```sql
SELECT address, status FROM keys WHERE address LIKE '%xmyn%';
```
- [ ] Status changed from `delivered` to `available`
- [ ] Key is now ready to be re-assigned to another staking request

### 10.5 Verify Provider UI
- [ ] Navigate to provider admin → Suppliers/Keys
- [ ] The key should show as "Available" (not "Delivered")

## Expected Result
The stale delivered key is automatically recovered and made available again since the supplier was never staked on-chain. No manual intervention needed.
