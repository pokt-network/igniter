# Scenario 1: Migration + ENV Seed to DB

Verifies that the DB migration renames `rpcUrl` -> `pocketApiUrl`, adds `pocketRpcUrl`, and that workflows seed the DB from ENV on first boot.

## Pre-conditions
- [ ] Old schema in place (column `rpcUrl` exists, `pocketApiUrl` does NOT exist)
- [ ] `application_settings` has a row with `rpcUrl` = some API URL
- [ ] ENV var `POKT_RPC_URL` is set in the workflow deployment

## Steps

### 1.1 Run migration
- [ ] Run `pnpm middleman:migration:migrate` (or deploy the new code which auto-migrates)
- [ ] Run `pnpm provider:migration:migrate`

### 1.2 Verify column rename
```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'application_settings' ORDER BY ordinal_position;
```
- [ ] `rpcUrl` column no longer exists
- [ ] `pocketApiUrl` column exists and contains the OLD `rpcUrl` value (data preserved)
- [ ] `pocketRpcUrl` column exists and is NULL

### 1.3 Start workflow workers
- [ ] Start middleman-workflows with `POKT_RPC_URL=https://sauron-rpc.infra.pocket.network`
- [ ] Check worker logs for: `"Seeding pocketRpcUrl from POKT_RPC_URL env var"`

### 1.4 Verify DB was seeded
```sql
SELECT "pocketApiUrl", "pocketRpcUrl" FROM application_settings LIMIT 1;
```
- [ ] `pocketApiUrl` = original API URL (e.g. `https://sauron-api.infra.pocket.network`)
- [ ] `pocketRpcUrl` = ENV value (e.g. `https://sauron-rpc.infra.pocket.network`)

### 1.5 Restart worker without ENV
- [ ] Remove `POKT_RPC_URL` from env or set it empty
- [ ] Restart worker
- [ ] Worker should start successfully using DB values (no error about missing env)
- [ ] Worker logs should NOT show the "Seeding" message (DB already has value)

## Expected Result
Migration preserves existing data, ENV seeds DB once, subsequent restarts use DB only.
