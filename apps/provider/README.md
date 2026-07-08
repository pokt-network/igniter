# Provider

The Provider app is the operator-facing web interface for Pocket Network supplier operations (Shannon protocol). It provides tooling to help operators manage supplier keys, configure stakes, organize address groups, and set up delegator revenue sharing.

This README covers configuration and usage for node operators. For local development with Tilt, see the [Contributing guide](../../CONTRIBUTING.md).

---

## Table of Contents

- [Deployment](#deployment)
- [Environment Variables](#environment-variables)
- [Database Migrations](#database-migrations)
- [Bootstrap Wizard](#bootstrap-wizard)
- [Guides](#guides)
- [Reference](#reference)

---

## Deployment

For step-by-step deployment instructions (dependencies, configuration, and startup), see the [Docker Compose guide](../../docker-compose/README.md#2-provider-docker-composeappsproviderdocker-composeyaml).

---

## Environment Variables

Provider reads its configuration from a single `.env` file at `docker-compose/apps/provider/.env`. Copy `.env.sample` as a starting point.

All variables below are sourced from `docker-compose/apps/provider/.env.sample`.

### Compose

| Variable               | Required | Description                                          | Example / Default  |
|------------------------|----------|------------------------------------------------------|--------------------|
| `COMPOSE_PROJECT_NAME` | Optional | Docker Compose project name — scopes container names | `igniter-provider` |

### Next.js

| Variable    | Required | Description                                          | Example / Default |
|-------------|----------|------------------------------------------------------|-------------------|
| `NODE_ENV`  | Optional | Node runtime environment                             | `production`      |
| `LOG_LEVEL` | Optional | LogTape verbosity (`trace`, `debug`, `info`, `warning`, `error`, `fatal` — note `warning`, not `warn`) | `debug`            |

### Temporal

| Variable                      | Required | Description                                                | Example / Default     |
|-------------------------------|----------|------------------------------------------------------------|-----------------------|
| `TEMPORAL_URL`                | Required | Address of the Temporal server (from dependencies compose) | `temporal:7233`       |
| `TEMPORAL_NAMESPACE`          | Required | Temporal namespace for Provider workflows                  | `provider`            |
| `TEMPORAL_TASK_QUEUE`         | Required | Task queue name for dispatching workflow tasks             | `provider-operations` |
| `TEMPORAL_WORKFLOW_RETENTION` | Optional | How long to retain completed workflow history, in seconds  | `604800` (7 days)     |

### PostgreSQL

| Variable       | Required | Description                                                                 | Example / Default                                                              |
|----------------|----------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| `PGHOST`       | Required | PostgreSQL hostname (service name from dependencies compose)                | `postgresql`                                                                   |
| `PGUSER`       | Required | PostgreSQL username — must match `POSTGRES_USER` in dependencies `.env`     | `igniter`                                                                      |
| `PGPASSWORD`   | Required | PostgreSQL password — must match `POSTGRES_PASSWORD` in dependencies `.env` | *(no default — set this)*                                                      |
| `DB_NAME`      | Required | Database name for Provider                                                  | `provider`                                                                     |
| `DATABASE_URL` | Required | Full connection string — interpolated from the four vars above              | `postgres://${PGUSER}:${PGPASSWORD}@${PGHOST}:5432/${DB_NAME}?sslmode=disable` |

> **Note:** `PGPASSWORD` must exactly match `POSTGRES_PASSWORD` in `docker-compose/dependencies/.env`. If they don't match, migrations and the app will fail to connect.

### Pocket Network

| Variable               | Required | Description                                                                                                                          | Example / Default                                      |
|------------------------|----------|--------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| `POKT_RPC_URL`         | Required | CometBFT RPC endpoint. Seeded into the database on first boot if not already configured via the setup wizard                         | `https://sauron-rpc.beta.infra.pocket.network`         |
| `CHAIN_ID`             | Required | Blockchain chain identifier                                                                                                          | `pocket-beta`                                          |
| `BLOCKCHAIN_PROTOCOL`  | Required | Protocol version (`shannon`)                                                                                                         | `shannon`                                              |
| `OWNER_IDENTITY`       | Required | POKT bech32 wallet address of the Provider owner — must be a valid `pokt1...` address. Used to restrict pre-bootstrap login via SIWP | `pokt1abc123...`                                       |
| `OWNER_EMAIL`          | Required | Email address for the owner account                                                                                                  | `operator@example.com`                                 |
| `APP_IDENTITY`         | Required | Hex-encoded private key used by the Provider to sign governance responses sent to the Middleman                                      | *(your private key hex)*                               |
| `MINIMUM_STAKE_BUFFER` | Optional | Buffer subtracted from minimum on-chain stake to allow nodes to operate after slashes, in uPOKT                                      | `500000000`                                            |
| `DELEGATORS_CDN_URL`   | Optional | CDN URL template for fetching delegator configuration JSON. `{chainId}` is replaced at runtime                                       | `https://raw.githubusercontent.com/.../middleman.json` |

### Application

| Variable          | Required | Description                                                                   | Example / Default       |
|-------------------|----------|-------------------------------------------------------------------------------|-------------------------|
| `APP_URL`         | Required | Public URL where Provider is accessible — used for redirect links and CORS    | `http://localhost:3001` |
| `AUTH_URL`        | Required | URL used by NextAuth for auth callbacks — typically same as `APP_URL`         | `http://localhost:3001` |
| `AUTH_TRUST_HOST` | Optional | Set `true` if running behind a reverse proxy (trusts `X-Forwarded-*` headers) | `false`                 |

### Security / Encryption

| Variable         | Required | Description                                               | How to generate        |
|------------------|----------|-----------------------------------------------------------|------------------------|
| `ENCRYPTION_IV`  | Required | Initialization vector for database private key encryption | `openssl rand -hex 16` |
| `ENCRYPTION_KEY` | Required | Key for database private key encryption                   | `openssl rand -hex 32` |
| `AUTH_SECRET`    | Required | Secret used to encrypt website session tokens             | `openssl rand -hex 24` |

> **Note:** Generate unique values for `ENCRYPTION_IV`, `ENCRYPTION_KEY`, and `AUTH_SECRET` before deploying. Never reuse values across environments or share them publicly.

---

## Database Migrations

Migrations run automatically via the `provider-migration` service every time you run `docker compose up`. The service uses Drizzle ORM to apply any pending schema changes, then exits with code 0. The web and workflows services will not start until migration completes successfully.

If you need to run migrations manually outside of Docker (e.g., in CI or during local development):

```bash
pnpm provider:migration:migrate
```

---

## Bootstrap Wizard

After deployment, the Provider app is running but not yet configured. The bootstrap wizard is a one-time setup flow that walks you through connecting to the blockchain, setting your identity, configuring regions, relay miners, services, address groups, and delegators.

For the detailed step-by-step walkthrough, see the [Bootstrap guide](../../docs/guides/provider/bootstrap.md).

---

## Guides

Step-by-step tutorials for common Provider workflows.

| Guide | What it covers |
|-------|----------------|
| [Bootstrap Wizard](../../docs/guides/provider/bootstrap.md) | One-time setup wizard — blockchain, identity, regions, miners, services |
| [How to set up a relay miner with address groups](../../docs/guides/provider/relay-miner-setup.md) | Configure a miner, create groups, and assign services step by step |
| [How to manage your key inventory](../../docs/guides/provider/key-inventory.md) | Import keys, track their lifecycle states, and export when needed |
| [How to onboard a new delegator](../../docs/guides/provider/onboard-delegator.md) | End-to-end flow from receiving keys to enabling a delegator |
| [Notifications](../../docs/guides/provider/notifications.md) | Set up Discord, Telegram, or email delivery for supplier and workflow events |

## Reference

Detailed feature documentation for each admin area.

| Doc                                            | What it covers                                                           |
|------------------------------------------------|--------------------------------------------------------------------------|
| [Relay Miners](../../docs/reference/provider/relay-miners.md)     | Register and configure relay miner nodes                                 |
| [Address Groups](../../docs/reference/provider/address-groups.md) | Organize miners into groups with service and revenue share configuration |
| [Key Management](../../docs/reference/provider/key-management.md) | Import, track, and export supplier keys through their lifecycle          |
| [Delegators](../../docs/reference/provider/delegators.md)         | Enable delegators and manage revenue sharing, including CDN import       |
| [Workflows](../../docs/reference/provider/workflows.md)           | Inspect running/recent Temporal workflows and schedule health            |
| [Notifications](../../docs/reference/provider/notifications.md)   | Instance-wide event types, channels, shared SMTP, and delivery config    |
