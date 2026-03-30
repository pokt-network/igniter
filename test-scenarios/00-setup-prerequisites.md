# Prerequisites for All Test Scenarios

## Environment
- [ ] Localnet running in Tilt (or staging cluster accessible)
- [ ] PostgreSQL accessible (direct or via port-forward)
- [ ] Temporal UI accessible (http://localhost:8233 or port-forward)
- [ ] Both middleman and provider apps deployed with the new code
- [ ] At least 2 pre-staked supplier keys available in provider
- [ ] Wallet with sufficient POKT balance for staking (>= 2x minimum stake + operational funds)

## Database Access
```bash
# Localnet
psql -U postgres -d igniter-middleman-localnet
psql -U postgres -d igniter-provider-localnet

# Staging (via k8s exec)
kubectl exec -n postgresql pg-ha-cluster-6 -- psql -U postgres -d igniter-middleman-mainnet
```

## Useful Queries
```sql
-- Check application_settings columns
SELECT "pocketApiUrl", "pocketRpcUrl" FROM application_settings LIMIT 1;

-- Check pending transactions
SELECT id, hash, status, "executionHeight", "createdAt" FROM transactions WHERE status = 'pending';

-- Check delivered keys
SELECT address, status, "deliveredAt" FROM keys WHERE status = 'delivered';
```

## Temporal CLI
```bash
# List recent workflows
tctl --namespace middleman-<env> workflow list

# Show workflow history
tctl --namespace middleman-<env> workflow show --workflow_id <id>
```
