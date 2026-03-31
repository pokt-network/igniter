# Test Scenarios — Pocket API/RPC URL Separation + TX Verification Fix

## Summary

These test scenarios cover the fix for stuck pending transactions and the proper separation of Pocket API URLs from RPC URLs.

## Scenarios

| # | Name | Status | Notes |
|---|------|--------|-------|
| 00 | [Prerequisites](00-setup-prerequisites.md) | PASS | Tilt localnet |
| 01 | [Migration + ENV Seed](01-migration-and-env-seed.md) | PASS | Both middleman + provider: NULL pocketRpcUrl seeded from POKT_RPC_URL env on restart |
| 02 | [Setup Form Dual URL](02-setup-form-dual-url.md) | PASS | Both forms show API+RPC inputs, validation works, Save blocked during/after validation errors |
| 03 | [Tier 1 — RPC tx_index](03-verify-transaction-tier1-rpc.md) | PASS | TX 2 — full stake flow, verifyTransaction [true,0,"151198"] |
| 04 | [Tier 2 — REST API](04-verify-transaction-tier2-api.md) | UNIT TESTS | 13/13 pass. Cannot test in localnet (tx_index works) |
| 05 | [Tier 3 — Block Scan](05-verify-transaction-tier3-block-scan.md) | UNIT TESTS | 13/13 pass. Cannot test in localnet (tx_index works) |
| 06 | [Tier 4 — Supplier Check](06-verify-transaction-tier4-supplier-check.md) | PASS | TX 3 — fake hash, expired, supplier not found → failure |
| 07 | [TX Expiration](07-tx-expiration.md) | PASS | TX 3 — executionHeight=10, current=195, >30 blocks → failure |
| 08 | [Provider Key Recovery](08-provider-key-recovery.md) | PASS | delivered >24h → available via SupplierStatus (no separate workflow needed) |
| 09 | [E2E: Ajes Case](09-end-to-end-ajes-case.md) | STAGING | Requires mainnet data |
| 10 | [E2E: JonatanM Case](10-end-to-end-jonatan-case.md) | STAGING | Requires mainnet data |

## Execution Order

1. Run unit tests first (Scenarios 4, 5 via `pnpm test`)
2. Deploy to localnet/staging
3. Run Scenario 1 (migration)
4. Run Scenario 2 (setup forms)
5. Run Scenario 3 (happy path)
6. Run Scenarios 6, 7, 8 (fallback and recovery)
7. Run Scenarios 9, 10 (production bug reproduction)
