# Test Scenarios — Pocket API/RPC URL Separation + TX Verification Fix

## Summary

These test scenarios cover the fix for stuck pending transactions and the proper separation of Pocket API URLs from RPC URLs.

## Scenarios

| # | Name | What it tests |
|---|------|---------------|
| 00 | [Prerequisites](00-setup-prerequisites.md) | Environment setup, DB access, useful queries |
| 01 | [Migration + ENV Seed](01-migration-and-env-seed.md) | DB column rename, new column, ENV→DB seeding |
| 02 | [Setup Form Dual URL](02-setup-form-dual-url.md) | Both apps show API + RPC inputs, presets work |
| 03 | [Tier 1 — RPC tx_index](03-verify-transaction-tier1-rpc.md) | Normal happy path still works |
| 04 | [Tier 2 — REST API](04-verify-transaction-tier2-api.md) | REST API fallback when RPC fails |
| 05 | [Tier 3 — Block Scan](05-verify-transaction-tier3-block-scan.md) | SHA256 block scan when both RPC and API fail |
| 06 | [Tier 4 — Supplier Check](06-verify-transaction-tier4-supplier-check.md) | Circuit breaker: check supplier exists on-chain |
| 07 | [TX Expiration](07-tx-expiration.md) | Stale TXs (>30 blocks) marked as failed |
| 08 | [Provider Key Recovery](08-provider-key-recovery.md) | Delivered keys >24h recovered based on chain state |
| 09 | [E2E: Ajes Case](09-end-to-end-ajes-case.md) | Reproduce + fix the actual stuck TX #57 |
| 10 | [E2E: JonatanM Case](10-end-to-end-jonatan-case.md) | Reproduce + fix the delivered-but-never-staked key |

## Execution Order

1. Run unit tests first (Scenarios 4, 5 via `pnpm test`)
2. Deploy to localnet/staging
3. Run Scenario 1 (migration)
4. Run Scenario 2 (setup forms)
5. Run Scenario 3 (happy path)
6. Run Scenarios 6, 7, 8 (fallback and recovery)
7. Run Scenarios 9, 10 (production bug reproduction)
