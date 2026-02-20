[< Back to Middleman documentation](../../README.md)

# Overview Dashboard

The overview dashboard is the landing page after login. It displays a summary of your staking portfolio with key metrics and a rewards graph. Use it to get a quick snapshot of your staking activity and earnings.

Middleman has two overview pages — one for delegators/owners and one for the admin operator. Both are described below.

---

## User Overview (`/app/overview`)

The user overview shows staking metrics scoped to the connected wallet owner's addresses and their supplier nodes.

<!-- SCREENSHOT: Capture the /app/overview page showing the full user overview layout with rewards summary and rewards graph. -->
<!-- ![Screenshot: User overview page](../screenshots/user-overview.png) -->

### Quick Actions Bar

The header contains two action buttons:

| Button | Action |
|--------|--------|
| **Import Suppliers** | Navigates to the import suppliers flow (`/app/import-suppliers`) |
| **New Stake** | Navigates to the staking flow (`/app/stake`) |

### Rewards Summary Section

Displays aggregate staking metrics for all supplier addresses under the connected owner:

- **Staked Tokens** — Total POKT currently staked across all supplier nodes
- **Rewards (24h)** — Rewards earned in the last 24 hours
- **Rewards (48h)** — Rewards earned in the last 48 hours

If no stakes exist, the section displays:

> You do not have any stake yet. Stake to start getting rewards.

### Rewards Graph Section

A line chart showing rewards earned over time for the connected owner's addresses.

- Data is fetched from the Pocket Network indexer API
- The indexer URL is configured in Settings (`indexerApiUrl`) or falls back to chain-specific defaults
- Displays the same no-data message if no stakes exist

---

## Admin Overview (`/admin/overview`)

The admin overview shows staking metrics for the delegator rewards address configured in Settings. This covers all staked nodes managed by this Middleman instance, across all users.

> **Note:** Admin overview does not have quick action buttons (no Import Suppliers or New Stake buttons).

<!-- SCREENSHOT: Capture the /admin/overview page showing the full admin overview layout with rewards summary and rewards graph. -->
<!-- ![Screenshot: Admin overview page](../screenshots/admin-overview.png) -->

### Rewards Summary Section

Displays aggregate metrics using the delegator rewards address (configured in Settings → Application Settings → Delegator Rewards Address):

- **Staked Tokens** — Total POKT staked across all nodes for this Middleman instance
- **Rewards (24h)** — Rewards earned in the last 24 hours
- **Rewards (48h)** — Rewards earned in the last 48 hours

### Rewards Graph Section

A line chart showing rewards earned over time, scoped to all staked nodes managed by this Middleman instance.

---

## Data Sources

Reward data comes from the Pocket Network indexer API. The indexer URL is configured in Settings (`indexerApiUrl`). If not set, Middleman falls back to chain-specific defaults:

| Chain | Fallback |
|-------|---------|
| `pocket` | `MAINNET_INDEXER_API_URL` |
| `pocket-beta` | `BETA_INDEXER_API_URL` |
| `pocket-alpha` | `ALPHA_INDEXER_API_URL` |

---

**See also:** [Staking](./staking.md) · [Unstaking](./unstaking.md) · [Import Suppliers](./import-suppliers.md) · [Transactions](./transactions.md)
