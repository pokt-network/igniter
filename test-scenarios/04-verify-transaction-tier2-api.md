# Scenario 4: verifyTransaction — Tier 2 (REST API Fallback)

Verifies that when RPC tx_index fails, the REST API fallback works.

## Pre-conditions
- [ ] Localnet or staging with a KNOWN successful TX hash
- [ ] The TX must exist on-chain but NOT be findable via RPC `getTx()` (simulate by using a node with incomplete tx_index, or by mocking)

## Simulating RPC tx_index failure

### Option A: Use staging with real data
- [ ] Use the known TX `F7D3CF2B836A566C36BD47BB331A04A25B5988710A00552F75B21A1C425EB7A3` (Ajes case)
- [ ] Point `pocketRpcUrl` to `sauron-rpc` (which doesn't have this TX indexed)
- [ ] Point `pocketApiUrl` to `sauron-api` (may or may not have it — test to confirm)

### Option B: Unit test (recommended)
- [ ] Run `pnpm test` in `packages/pocket`
- [ ] Verify test case: "RPC null + API success → falls back to API, returns result"
- [ ] Mock `StargateClient.getTx()` to return null
- [ ] Mock `fetch` for the API URL to return a valid `tx_response`
- [ ] Verify `getTransaction()` returns the correct `TransactionResult`

## Steps (if using Option A)

### 4.1 Insert a pending TX manually
```sql
INSERT INTO transactions (hash, type, status, "executionHeight", ...)
VALUES ('F7D3CF2B...', 'Stake', 'pending', 680011, ...);
```

### 4.2 Trigger ExecutePendingTransactions
- [ ] Wait for the scheduled workflow to pick it up, or trigger manually

### 4.3 Check Logs
- [ ] Middleman-workflows logs should show:
  - `"RPC getTx returned null, trying REST API fallback"`
  - Either success from API or fallback to Tier 3

### 4.4 Verify Outcome
- [ ] If API found the TX: status = `success`, verificationHeight set
- [ ] If API also failed: falls through to Tier 3 (block scan)

## Expected Result
REST API fallback is attempted when RPC returns null, with appropriate logging.
