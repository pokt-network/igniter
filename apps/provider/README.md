# Provider

The Provider app is the operator-facing control plane for Pocket Network staking. It manages relay miner nodes, address groups, key lifecycle, and delegator revenue sharing — giving node operators a self-hosted web interface to run supplier operations on the Pocket Network (Shannon protocol).

This README is for **node operators** running their own Provider instance via Docker Compose.

> **Note:** For local development with Tilt, see the root [CONTRIBUTING](../../CONTRIBUTING.md) guide. This document covers production-style deployment only.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Variables](#environment-variables)
- [Deployment with Docker Compose](#deployment-with-docker-compose)
- [Database Migrations](#database-migrations)
- [Bootstrap Wizard](#bootstrap-wizard)
- [Admin Workflows](#admin-workflows)

## Admin Workflows

| Doc | What it covers |
|-----|----------------|
| [Relay Miners](docs/admin/relay-miners.md) | Create, update, and manage relay miner nodes |
| [Address Groups](docs/admin/address-groups.md) | Organize miners into groups with service and revenue share configuration |
| [Key Management](docs/admin/key-management.md) | Import, track, and export keys through their lifecycle |
| [Delegators](docs/admin/delegators.md) | Enable delegators and manage revenue sharing, including CDN import |

---

## Prerequisites

Before deploying, you need:

- **Docker** and **Docker Compose** (v2+)
- **A Pocket Network wallet address** — used as the owner identity for SIWP login (`OWNER_IDENTITY`)
- **A Pocket Network private key** — used to sign governance responses to the Middleman (`APP_IDENTITY`)
- **Access to a Pocket Network RPC endpoint** — can be your own node or a public endpoint

---

## Environment Variables

Provider reads its configuration from a single `.env` file at `docker-compose/apps/provider/.env`. Copy `.env.sample` as a starting point.

All vars below are sourced from `docker-compose/apps/provider/.env.sample` and verified against `apps/provider/src/config/env.ts`.

### Compose

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `COMPOSE_PROJECT_NAME` | Optional | Docker Compose project name — scopes container names | `igniter-provider` |

### Next.js

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `NODE_ENV` | Optional | Node runtime environment | `production` |
| `LOG_LEVEL` | Optional | Logging verbosity (`error`, `warn`, `info`, `debug`) | `info` |

### Temporal

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `TEMPORAL_URL` | Required | Address of the Temporal server (from dependencies compose) | `temporal:7233` |
| `TEMPORAL_NAMESPACE` | Required | Temporal namespace for Provider workflows | `provider` |
| `TEMPORAL_TASK_QUEUE` | Required | Task queue name for dispatching workflow tasks | `provider-operations` |
| `TEMPORAL_WORKFLOW_RETENTION` | Optional | How long to retain completed workflow history, in seconds | `604800` (7 days) |

### PostgreSQL

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `PGHOST` | Required | PostgreSQL hostname (service name from dependencies compose) | `postgresql` |
| `PGUSER` | Required | PostgreSQL username — must match `POSTGRES_USER` in dependencies `.env` | `igniter` |
| `PGPASSWORD` | Required | PostgreSQL password — must match `POSTGRES_PASSWORD` in dependencies `.env` | *(no default — set this)* |
| `DB_NAME` | Required | Database name for Provider | `provider` |
| `DATABASE_URL` | Required | Full connection string — interpolated from the four vars above | `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB_NAME}?sslmode=disable` |

> **Note:** `PGPASSWORD` must exactly match `POSTGRES_PASSWORD` in `docker-compose/dependencies/.env`. If they don't match, migrations and the app will fail to connect.

### Pocket Network

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `POKT_RPC_URL` | Required | Pocket Network RPC endpoint used by the workflows service to submit transactions | `https://sauron-rpc.beta.infra.pocket.network` |
| `CHAIN_ID` | Required | Blockchain chain identifier | `pocket-beta` |
| `BLOCKCHAIN_PROTOCOL` | Required | Protocol version (`shannon`) | `shannon` |
| `OWNER_IDENTITY` | Required | POKT bech32 wallet address of the Provider owner — must be a valid `pokt1...` address. Used to restrict pre-bootstrap login via SIWP | `pokt1abc123...` |
| `OWNER_EMAIL` | Required | Email address for the owner account | `operator@example.com` |
| `APP_IDENTITY` | Required | Hex-encoded private key used by the Provider to sign governance responses sent to the Middleman | *(your private key hex)* |
| `MINIMUM_STAKE_BUFFER` | Optional | Buffer subtracted from minimum on-chain stake to allow nodes to operate after slashes, in uPOKT | `500000000` |
| `DELEGATORS_CDN_URL` | Optional | CDN URL template for fetching delegator configuration JSON. `{chainId}` is replaced at runtime | `https://raw.githubusercontent.com/.../middleman.json` |

### Application

| Variable | Required | Description | Example / Default |
|----------|----------|-------------|-------------------|
| `APP_URL` | Required | Public URL where Provider is accessible — used for redirect links and CORS | `http://localhost:3001` |
| `AUTH_URL` | Required | URL used by NextAuth for auth callbacks — typically same as `APP_URL` | `http://localhost:3001` |
| `AUTH_TRUST_HOST` | Optional | Set `true` if running behind a reverse proxy (trusts `X-Forwarded-*` headers) | `false` |

### Security / Encryption

| Variable | Required | Description | How to generate |
|----------|----------|-------------|-----------------|
| `ENCRYPTION_IV` | Required | Initialization vector for database private key encryption | `openssl rand -hex 16` |
| `ENCRYPTION_KEY` | Required | Key for database private key encryption | `openssl rand -hex 32` |
| `AUTH_SECRET` | Required | Secret used to encrypt website session tokens | `openssl rand -hex 24` |

> **Note:** Generate unique values for `ENCRYPTION_IV`, `ENCRYPTION_KEY`, and `AUTH_SECRET` before deploying. Never reuse values across environments or share them publicly.

---

## Deployment with Docker Compose

Provider runs as three Docker Compose services that depend on shared infrastructure (PostgreSQL + Temporal) started from `docker-compose/dependencies/`.

### Step 1: Clone the repository

```bash
git clone https://github.com/pokt-network/igniter.git
cd igniter
```

### Step 2: Start dependencies

The `dependencies` compose starts PostgreSQL and Temporal — both must be healthy before the Provider services can connect.

```bash
cd docker-compose/dependencies
cp .env.sample .env
```

Open `.env` and change the default passwords:

```
POSTGRES_PASSWORD=your-secure-password
```

> **Note:** The default `POSTGRES_PASSWORD=igniter` is not suitable for production. Change it now — you will reference this same password in the Provider `.env`.

Then start the dependencies:

```bash
docker compose up -d
```

Wait for all services to become healthy (`docker compose ps`). The `igniter` Docker network is created at this step — the Provider services connect to it as an external network.

### Step 3: Configure Provider

```bash
cd docker-compose/apps/provider
cp .env.sample .env
```

Fill in the required values in `.env`. At minimum, you must set:

- `PGPASSWORD` — must match `POSTGRES_PASSWORD` from the dependencies `.env`
- `OWNER_IDENTITY` — your `pokt1...` wallet address
- `APP_IDENTITY` — your hex private key for governance signing
- `POKT_RPC_URL` — a Pocket Network RPC endpoint
- `ENCRYPTION_IV`, `ENCRYPTION_KEY`, `AUTH_SECRET` — generate with `openssl rand -hex 16/32/24`
- `OWNER_EMAIL` — your email address

Refer to the [Environment Variables](#environment-variables) section above for the full reference.

### Step 4: Start Provider services

```bash
docker compose up -d
```

Docker Compose starts three services in dependency order:

| Service | Image | What it does |
|---------|-------|--------------|
| `provider-migration` | `ghcr.io/pokt-network/provider:latest` | Runs Drizzle ORM migrations to create or update the Provider database schema. Runs once and exits — must complete successfully before the other services start. |
| `provider-web` | `ghcr.io/pokt-network/provider:latest` | The Next.js web application, exposed on port `3001`. Handles the admin UI, SIWP authentication, and API routes. Starts only after migrations complete. |
| `provider-workflows` | `ghcr.io/pokt-network/provider-workflows:latest` | The Temporal workflow worker. Processes background jobs for staking, unstaking, transaction signing, and supplier remediation. Connects to the same Temporal server as the web app. Starts only after migrations complete. |

All three services connect to the shared `igniter` Docker network created by the dependencies compose.

### Step 5: Verify

```bash
docker compose ps
```

All three services should show `running` (or `exited` with code 0 for `provider-migration`). The web app is accessible at the `APP_URL` you configured (default: `http://localhost:3001`).

---

## Database Migrations

Migrations run automatically via the `provider-migration` service every time you run `docker compose up`. The service uses Drizzle ORM to apply any pending schema changes, then exits with code 0. The web and workflows services will not start until migration completes successfully.

If you need to run migrations manually outside of Docker (e.g., in CI or during local development):

```bash
pnpm provider:migration:migrate
```

---

## Bootstrap Wizard

After deployment, the Provider app is running but not yet configured. The bootstrap wizard is a one-time setup flow that configures the application for your environment.

**How to access:** Navigate to `APP_URL/admin/setup` and sign in using SIWP (Sign-In with Pocket). Only the wallet address set in `OWNER_IDENTITY` can log in before bootstrap is complete.

<!-- SCREENSHOT: Capture the /admin/setup page showing the stepper with all 7 steps visible. -->
<!-- ![Screenshot: Bootstrap wizard overview](docs/screenshots/bootstrap-wizard.png) -->

The wizard walks through 7 steps in sequence:

| Step | Name | What you configure |
|------|------|-------------------|
| 1 | **Blockchain Settings** | Chain ID and protocol (e.g., `pocket-beta`, `shannon`) |
| 2 | **Identity Settings** | App identity and display name for this Provider instance |
| 3 | **Configure Regions** | Geographic regions that miners will be assigned to |
| 4 | **Configure Relay Miners** | Add relay miner nodes that this Provider will manage |
| 5 | **Select Provided Services** | Choose which Pocket Network services this Provider will relay |
| 6 | **Address Groups** | Create groups linking miners, services, and revenue share configuration |
| 7 | **Delegators** | Configure delegator settings and optionally import via CDN |

After completing all 7 steps, click **Complete** to finalize bootstrap. Once bootstrapped, all wallet addresses that can authenticate via SIWP will have access to the admin UI (not only the owner).

For detailed walkthroughs of the management areas configured during and after bootstrap, see the [Admin Workflows](#admin-workflows) section above.
