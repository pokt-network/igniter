# Middleman

Middleman is the delegator/owner-facing staking interface for Pocket Network. It handles staking, unstaking, importing suppliers, reward monitoring, and transaction tracking — giving delegators a self-hosted web interface to manage their staking portfolio on the Pocket Network (Shannon protocol).

This README is for **delegators/owners** running their own Middleman instance via Docker Compose.

> **Note:** Middleman and Provider are independently deployed by different actors. A Middleman operator does not need to run their own Provider. For local development with Tilt, see the root [CONTRIBUTING](../../CONTRIBUTING.md) guide. This document covers production-style deployment only.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Deployment with Docker Compose](#deployment-with-docker-compose)
- [Database Migrations](#database-migrations)
- [Bootstrap Wizard](#bootstrap-wizard)
- [Guides](#guides)
- [Reference](#reference)

---

## Prerequisites

Before deploying, you need:

- **Docker** and **Docker Compose** (v2+)
- **A Pocket Network wallet address** — used as the owner identity for SIWP login (`OWNER_IDENTITY`). Must be a valid `pokt1...` bech32 address.
- **A Pocket Network private key** — used for governance signing (`APP_IDENTITY`). This is a hex-encoded private key.
- **Access to a Pocket Network node** — you need both the Cosmos SDK REST API endpoint (port `1317`) and the CometBFT RPC endpoint (port `26657`). Both are configured during the setup wizard. The `POKT_RPC_URL` env var seeds the RPC URL into the database on first boot if not already set. You can use your own node or [public endpoints](https://github.com/pokt-network/pocket-network-resources).
- **A CoinMarketCap API key** — used to display POKT coin value to users. Get one at [coinmarketcap.com/api](https://coinmarketcap.com/api/documentation/v1/)

---

## Environment Variables

Middleman reads its configuration from a single `.env` file at `docker-compose/apps/middleman/.env`. Copy `.env.sample` as a starting point.

All vars below are sourced from `docker-compose/apps/middleman/.env.sample` and verified against `apps/middleman/src/config/env.ts`.

### Compose

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `COMPOSE_PROJECT_NAME` | Optional | Docker Compose project name — scopes container names | `igniter-middleman` |

### Next.js

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `NODE_ENV` | Optional | Node runtime environment | `production` |
| `LOG_LEVEL` | Optional | Logging verbosity (`error`, `warn`, `info`, `debug`) | `info` |

### Temporal

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `TEMPORAL_URL` | Required | Address of the Temporal server (from dependencies compose) | `temporal:7233` |
| `TEMPORAL_NAMESPACE` | Required | Temporal namespace for Middleman workflows | `middleman` |
| `TEMPORAL_TASK_QUEUE` | Required | Task queue name for dispatching workflow tasks | `middleman-operations` |
| `TEMPORAL_WORKFLOW_RETENTION` | Optional | How long to retain completed workflow history, in seconds | `604800` (7 days) |

### PostgreSQL

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `PGHOST` | Required | PostgreSQL hostname (service name from dependencies compose) | `postgresql` |
| `PGUSER` | Required | PostgreSQL username — must match `POSTGRES_USER` in dependencies `.env` | `igniter` |
| `PGPASSWORD` | Required | PostgreSQL password — must match `POSTGRES_PASSWORD` in dependencies `.env` | *(no default — set this)* |
| `DB_NAME` | Required | Database name for Middleman | `middleman` |
| `DATABASE_URL` | Required | Full connection string — interpolated from the four vars above | `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB_NAME}?sslmode=disable` |

> **Note:** `PGPASSWORD` must exactly match `POSTGRES_PASSWORD` in `docker-compose/dependencies/.env`. If they don't match, migrations and the app will fail to connect.

### Pocket Network

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `POKT_RPC_URL` | Required | CometBFT RPC endpoint. Seeded into the database on first boot if not already configured via the setup wizard | `https://sauron-rpc.beta.infra.pocket.network` |
| `CHAIN_ID` | Required | Blockchain chain identifier | `pocket-beta` |
| `BLOCKCHAIN_PROTOCOL` | Required | Protocol version (`shannon`) | `shannon` |
| `OWNER_IDENTITY` | Required | POKT bech32 wallet address of the Middleman owner — must be a valid `pokt1...` address. Used to restrict pre-bootstrap login via SIWP | `pokt1abc123...` |
| `OWNER_EMAIL` | Required | Email address for the owner account | `delegator@example.com` |
| `APP_IDENTITY` | Required | Hex-encoded private key used by Middleman for governance signing | *(your private key hex)* |
| `MINIMUM_STAKE_BUFFER` | Optional | Buffer subtracted from minimum on-chain stake to allow nodes to operate after slashes, in uPOKT | `500000000` |
| `PROVIDERS_CDN_URL` | Optional | CDN URL template for fetching the list of available providers. Used by bootstrap-seed and the `GovernanceSync` Temporal workflow (in middleman-workflows). `{chainId}` is replaced at runtime with `CHAIN_ID` | `https://raw.githubusercontent.com/pokt-network/igniter-governance/refs/heads/main/{chainId}/provider.json` |

> **Note:** `PROVIDERS_CDN_URL` must be set in both the middleman app (for bootstrap) and middleman-workflows (for the scheduled GovernanceSync workflow). In local Tilt development, both are automatically overridden to use the local `governance-nginx` service.

### Application

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `APP_URL` | Required | Public URL where Middleman is accessible — used for redirect links and CORS | `http://localhost:3000` |
| `AUTH_URL` | Required | URL used by NextAuth for auth callbacks — typically same as `APP_URL` | `http://localhost:3000` |
| `AUTH_TRUST_HOST` | Optional | Set to `true` if running behind a reverse proxy (trusts `X-Forwarded-*` headers) | `false` |

> **Note:** Middleman runs on port `3000` by default. If running both Provider and Middleman on the same host, one of them must use a different port (Provider defaults to `3001`).

### Security

| Variable | Required | Description | How to generate |
|----------|----------|-------------|-----------------|
| `AUTH_SECRET` | Required | Secret used to encrypt website session tokens | `openssl rand -hex 24` |
| `NOTIFICATION_ENCRYPTION_KEY` | Optional | Secret-at-rest encryption for notification-channel credentials (webhook URL, bot token, SMTP password). Only needed if users configure notification channels; the rest of the app runs without it. **Use a different key than Provider.** | `openssl rand -hex 32` |

> **Note:** Middleman does not store private keys in the database the way Provider does, so it needs no `ENCRYPTION_IV` and does not share Provider's `ENCRYPTION_KEY`. It uses its own `NOTIFICATION_ENCRYPTION_KEY` solely to encrypt notification-channel secrets at rest (elective — see the Notifications feature). `AUTH_SECRET` remains required for session encryption.

### External Services

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `COIN_MARKET_CAP_API_KEY` | Required | API key for CoinMarketCap — used to display current POKT coin value to users. Get one at [coinmarketcap.com/api](https://coinmarketcap.com/api/documentation/v1/) | *(your API key)* |

---

## Deployment with Docker Compose

Middleman runs as three Docker Compose services that depend on shared infrastructure (PostgreSQL + Temporal) started from `docker-compose/dependencies/`.

### Step 1: Clone the repository

```bash
git clone https://github.com/pokt-network/igniter.git
cd igniter
```

### Step 2: Start dependencies

The `dependencies` compose starts PostgreSQL and Temporal — both must be healthy before Middleman services can connect.

```bash
cd docker-compose/dependencies
cp .env.sample .env
```

Open `.env` and change the default passwords:

```
POSTGRES_PASSWORD=your-secure-password
```

> **Note:** The default `POSTGRES_PASSWORD=igniter` is not suitable for production. Change it now — you will reference this same password in the Middleman `.env`.

Then start the dependencies:

```bash
docker compose up -d
```

Wait for all services to become healthy (`docker compose ps`). The `igniter` Docker network is created at this step — the Middleman services connect to it as an external network.

### Step 3: Configure Middleman

```bash
cd docker-compose/apps/middleman
cp .env.sample .env
```

Fill in the required values in `.env`. At minimum, you must set:

- `PGPASSWORD` — must match `POSTGRES_PASSWORD` from the dependencies `.env`
- `OWNER_IDENTITY` — your `pokt1...` wallet address
- `APP_IDENTITY` — your hex private key for governance signing
- `POKT_RPC_URL` — CometBFT RPC endpoint (seeded into DB on first boot)
- `AUTH_SECRET` — generate with `openssl rand -hex 24`
- `OWNER_EMAIL` — your email address
- `COIN_MARKET_CAP_API_KEY` — your CoinMarketCap API key

Refer to the [Environment Variables](#environment-variables) section above for the full reference.

### Step 4: Start Middleman services

```bash
docker compose up -d
```

Docker Compose starts three services in dependency order:

| Service | Image | What it does |
|---------|-------|--------------|
| `middleman-migration` | `ghcr.io/pokt-network/middleman:latest` | Runs Drizzle ORM migrations to create or update the Middleman database schema. Runs once and exits — must complete successfully before the other services start. |
| `middleman-web` | `ghcr.io/pokt-network/middleman:latest` | The Next.js web application, exposed on port `3000`. Handles the delegator UI, SIWP authentication, and API routes. Starts only after migrations complete. |
| `middleman-workflows` | `ghcr.io/pokt-network/middleman-workflows:latest` | The Temporal workflow worker. Processes background jobs for staking and unstaking transactions. Connects to the same Temporal server as the web app. Starts only after migrations complete. |

All three services connect to the shared `igniter` Docker network created by the dependencies compose.

### Step 5: Verify

```bash
docker compose ps
```

All three services should show `running` (or `exited` with code 0 for `middleman-migration`). The web app is accessible at the `APP_URL` you configured (default: `http://localhost:3000`).

---

## Database Migrations

Migrations run automatically via the `middleman-migration` service every time you run `docker compose up`. The service uses Drizzle ORM to apply any pending schema changes, then exits with code 0. The web and workflows services will not start until migration completes successfully.

If you need to run migrations manually outside of Docker (e.g., in CI or during local development):

```bash
pnpm middleman:migration:migrate
```

---

## Bootstrap Wizard

After deployment, Middleman is running but not yet configured. The bootstrap wizard is a one-time setup flow that configures the application for your environment.

**How to access:** Navigate to `APP_URL/admin/setup` and sign in using SIWP (Sign-In with Pocket). Only the wallet address set in `OWNER_IDENTITY` can log in before bootstrap is complete.

<!-- SCREENSHOT: Capture the /admin/setup page showing the stepper with all 4 steps visible. -->
<!-- ![Screenshot: Bootstrap wizard overview](docs/screenshots/bootstrap-wizard.png) -->

The wizard walks through 4 steps in sequence:

| Step | Name | What you configure |
|------|------|-------------------|
| 1 | **Blockchain Settings** | REST API URL (port `1317`), chain ID, and blockchain-derived settings (minimum stake buffer, app identity) |
| 2 | **Application Settings and Branding** | App name, support email, owner email, service fee percentage, delegator rewards address, and indexer API URL |
| 3 | **Configure Providers** | Select which providers are visible and enabled for staking |
| 4 | **Complete** | Review and finalize bootstrap — click Complete to activate the app |

After completing all 4 steps and clicking **Complete**, you are redirected to `/admin/overview`.

### Provider Discovery and Governance JSON Exchange

Middleman discovers available providers via the `PROVIDERS_CDN_URL`. This URL points to a governance repository JSON file that lists providers who have registered themselves as available for staking.

At runtime, `{chainId}` in `PROVIDERS_CDN_URL` is replaced with the value of `CHAIN_ID` to fetch the provider list for the correct network. The providers fetched from this URL are used during bootstrap (initial setup) and by the `GovernanceSync` Temporal workflow that runs every 5 minutes in middleman-workflows. The **Reload** button on the Providers admin page triggers this workflow manually. New providers are added as enabled and visible by default; providers removed from governance are disabled and hidden.

When a user stakes through Middleman, the application communicates directly with the selected Provider's API to request supplier addresses, and the owner signs the stake transaction locally. Middleman discovers which providers are available via the governance JSON, but the staking and import-suppliers flows require direct network access between Middleman and Provider instances.

### Admin vs. Delegator Interface

Once bootstrapped, Middleman exposes two interface areas:

- **`/admin/`** — For the Middleman operator. Manage application settings, configure which providers are available, and view all transactions across all delegators.
- **`/app/`** — For delegators. Stake, unstake, import suppliers, and monitor their staking portfolio and rewards.

---

## Guides

Step-by-step tutorials for common Middleman workflows.

| Guide | What it covers |
|-------|----------------|
| [How to stake your first nodes](../../docs/guides/middleman/stake-first-nodes.md) | Complete walkthrough from login to staked suppliers |
| [How to monitor your staking portfolio](../../docs/guides/middleman/monitor-portfolio.md) | Read the overview dashboard, understand rewards, and check transactions |
| [How to unstake and import suppliers](../../docs/guides/middleman/unstake-import-suppliers.md) | When and how to unstake nodes or claim already-staked suppliers |
| [Staking](../../docs/guides/middleman/staking.md) | Detailed staking flow: select provider, choose amount, pick offer, review, and execute |
| [Unstaking](../../docs/guides/middleman/unstaking.md) | Detailed unstaking flow: select owner, choose nodes, review, and execute |
| [Import Suppliers](../../docs/guides/middleman/import-suppliers.md) | Claim already-staked suppliers from a provider |
| [Notifications](../../docs/guides/middleman/notifications.md) | Set up Discord, Telegram, or email delivery for supplier, transaction, and import events |

## Reference

Detailed feature documentation for each area.

| Doc | What it covers |
|-----|----------------|
| [Overview Dashboard](../../docs/reference/middleman/overview.md) | Staked tokens summary, rewards tracking, and rewards graph |
| [Transactions](../../docs/reference/middleman/transactions.md) | Transaction history with status tracking and filtering |
| [Notifications](../../docs/reference/middleman/notifications.md) | Per-wallet event types, channels, in-app feed, and delivery configuration |
