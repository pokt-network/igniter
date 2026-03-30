# Scenario 5: verifyTransaction — Tier 3 (Block Scan)

Verifies that when both RPC and REST API fail to find a TX, the block scan finds it by hashing raw block TXs.

## Pre-conditions
- [ ] A TX that exists on-chain but is NOT in the tx_index of the RPC/API nodes
- [ ] The `executionHeight` is known and close to the actual inclusion height

## Unit Test Verification (Primary)

### 5.1 Run block scan tests
```bash
cd packages/pocket && pnpm test -- --testPathPattern getTransaction
```
- [ ] Test: "block scan finds TX at exact height" passes
- [ ] Test: "block scan finds TX at height + 3" passes (TX included a few blocks later)
- [ ] Test: "block scan returns null after 30 blocks" passes (TX not in range)

### 5.2 Verify SHA256 hashing of TX bytes
- [ ] Test builds a real `TxRaw` protobuf (MsgStakeSupplier message)
- [ ] Encodes to bytes → SHA256 → uppercase hex
- [ ] Mock `cometClient.block(height)` returns block with these bytes in `txs[]`
- [ ] `getTransactionFromBlock()` correctly matches the hash
- [ ] Returns the corresponding `blockResults().results[index]` data

### 5.3 Verify block results extraction
- [ ] Mock `cometClient.blockResults(height)` with specific code/gasUsed values
- [ ] Returned `TransactionResult` has correct `code`, `gasUsed`, `gasWanted`, `success`

## Integration Test (Staging — if applicable)

### 5.4 Test with real Ajes TX
- [ ] TX hash: `F7D3CF2B836A566C36BD47BB331A04A25B5988710A00552F75B21A1C425EB7A3`
- [ ] Known inclusion height: `680013`
- [ ] executionHeight in DB: `680011`
- [ ] Block scan should check blocks 680011 → 680041
- [ ] Should find the TX at block 680013 (offset +2 from executionHeight)
- [ ] Verify returned code = 0 (success), gasUsed = 142622

### 5.5 Edge Cases
- [ ] Block with 0 transactions → skip gracefully, continue to next block
- [ ] Block with 20+ transactions → correctly iterate all and match
- [ ] TX at the boundary (block 30 of scan range) → still found
- [ ] TX beyond 30 blocks → not found, returns null → falls to Tier 4

## Expected Result
Block scan correctly SHA256-hashes raw TX bytes, finds matching TX across a range of blocks, and extracts code/gas from block results.
