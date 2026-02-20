# Igniter

A staking operations platform for the Pocket Network ecosystem.

![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## What It Is

Igniter is a self-hosted web platform for managing Pocket Network staking operations. It provides tools for running relay miner infrastructure, handling supplier lifecycles, and giving token holders a clean interface to stake and monitor their positions.

It ships as two cooperating apps in a single monorepo, sharing a database, workflow engine, and common packages.

---

## Who It's For

**Operators** run Provider and Middleman on their own infrastructure. They manage keys, address groups, relay miners, and delegator relationships — everything needed to operate a Pocket Network supplier.

**Stakeholders / Delegators** use the Middleman interface to stake tokens, track rewards, import suppliers, and manage their staking portfolio without touching backend configuration.

---

## How the Apps Relate

| App | Audience | Responsibilities |
|-----|----------|-----------------|
| **Provider** | Operators | Keys, address groups, relay miners, delegator management, supplier lifecycle |
| **Middleman** | Delegators / Stakeholders | Staking, unstaking, import suppliers, overview dashboard, transaction history |

Both apps run alongside **Temporal workflow workers** that handle long-running operations (supplier staking, remediation, etc.) reliably in the background.

Shared packages provide common UI components, the database layer (Drizzle + PostgreSQL), GraphQL integration with Pocket Network, Temporal workflow definitions, and logging — so both apps stay consistent without duplicating code.

[View architecture diagram](docs/architecture.md)

---

## Monorepo Structure

```
igniter/
├── apps/
│   ├── provider/           # Operator-facing admin panel
│   ├── provider-workflows/ # Temporal worker for Provider
│   ├── middleman/          # Delegator-facing staking interface
│   └── middleman-workflows/# Temporal worker for Middleman
├── packages/
│   ├── @repo/ui            # Shared React component library
│   ├── @repo/db            # Drizzle ORM + PostgreSQL schema
│   ├── @repo/graphql       # Pocket Network GraphQL client
│   ├── @repo/pocket        # Pocket Network SDK integration
│   ├── @repo/temporal      # Temporal workflow definitions
│   ├── @repo/domain        # Shared domain types and logic
│   ├── @repo/commons       # Shared utilities
│   └── @repo/logger        # Structured logging
├── docker-compose/
│   ├── dependencies/
│   └── apps/
├── docs/
│   ├── architecture.md
│   └── guides/
│       ├── provider/
│       └── middleman/
└── CONTRIBUTING.md
```

- [docker-compose/](docker-compose/README.md) — Docker Compose deployment files
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contributing guide
- [docs/guides/](docs/guides/) — Step-by-step tutorials

---

## Getting Started

Step-by-step tutorials for learning Igniter workflows.

### Provider Guides

- [How to onboard a new delegator](docs/guides/provider/onboard-delegator.md) — End-to-end flow from receiving keys to enabling a delegator
- [How to set up a relay miner with address groups](docs/guides/provider/relay-miner-setup.md) — Configure a miner, create groups, and assign services step by step
- [How to manage your key inventory](docs/guides/provider/key-inventory.md) — Import keys, track their lifecycle states, and export when needed

### Middleman Guides

- [How to stake your first nodes](docs/guides/middleman/stake-first-nodes.md) — Complete walkthrough from login to staked suppliers
- [How to monitor your staking portfolio](docs/guides/middleman/monitor-portfolio.md) — Read the overview dashboard, understand rewards, and check transactions
- [How to unstake and import suppliers](docs/guides/middleman/unstake-import-suppliers.md) — When and how to unstake nodes or claim already-staked suppliers

---

## Setup

**Prerequisites:**
- Node.js >= 18 and [pnpm](https://pnpm.io/)
- PostgreSQL
- [Temporal Server](https://docs.temporal.io/self-hosted-guide) (self-hosted or Temporal Cloud)

**Clone and install:**

```bash
git clone https://github.com/pokt-network/igniter.git
cd igniter
pnpm install
```

**Run all apps in development:**

```bash
pnpm dev
```

Each app has its own setup guide covering environment variables, database migrations, and how to run in isolation:

- [Provider Setup](apps/provider/README.md)
- [Middleman Setup](apps/middleman/README.md)

For Docker Compose deployment details, see the [Docker Compose guide](docker-compose/README.md).

---

## Contributing

Bug reports and feature requests go to [GitHub Issues](https://github.com/pokt-network/igniter/issues).

See the [Contributing Guide](CONTRIBUTING.md) for development setup, coding conventions, and how to submit a pull request.

---

## Funded By

This project is funded by [Pocket Network Foundation](https://www.pokt.network/).
