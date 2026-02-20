# Igniter

A staking operations platform for the Pocket Network ecosystem.

![Build](https://img.shields.io/badge/build-passing-brightgreen)
![Node](https://img.shields.io/badge/node-%3E%3D18-blue)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

---

## What It Is

Igniter is an open-source platform for Pocket Network staking operations. It ships as two apps in a single monorepo — **Provider** and **Middleman** — sharing a database, workflow engine, and common packages.

- **Provider** is the core software for node operators. It manages keys, address groups, relay miners, supplier lifecycles, and delegator relationships — everything needed to run Pocket Network infrastructure.

- **Middleman** is a web-facing application that lets users stake tokens, track rewards, import suppliers, and manage their staking portfolio. Providers can optionally run Middleman alongside Provider to give their clients a direct interface for managing stake. Independent entities (like PNF) can also deploy Middleman as a standalone product, connecting users to any working Igniter-powered providers.

Since Igniter is open source, anyone can take Middleman as a base, extend it with additional features, and configure a service fee — a built-in mechanism that lets operators or third parties monetize the value they add on top of the platform.

---

## Who It's For

**Providers (Node Operators)** run the Provider app to operate Pocket Network suppliers. Optionally, they can also run Middleman as a client-facing interface so their delegators can connect and manage stake directly.

**Delegators / Stakeholders** use a Middleman instance — whether run by their provider or by an independent entity — to stake tokens, track rewards, and manage their portfolio without touching backend infrastructure.

---

## How the Apps Relate

| App           | Audience                  | Responsibilities                                                              |
|---------------|---------------------------|-------------------------------------------------------------------------------|
| **Provider**  | Operators                 | Keys, address groups, relay miners, delegator management, supplier lifecycle  |
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
- [docs/guides/](docs/guides/) — Step-by-step tutorials
- [CONTRIBUTING.md](CONTRIBUTING.md) — Contributing guide

---

## Setup

### Requirements

Igniter depends on two external services that you must provision — either self-hosted or cloud-managed:

- **PostgreSQL** — Stores all application data. For Provider deployments this includes encrypted private keys, so follow [PostgreSQL security best practices](https://www.postgresql.org/docs/current/security.html) for your environment.
- **Temporal Server** — Orchestrates long-running workflows (staking, remediation, etc.). Can be [self-hosted](https://docs.temporal.io/self-hosted-guide) or run via [Temporal Cloud](https://temporal.io/cloud). Follow [Temporal's security guidance](https://docs.temporal.io/production-readiness/develop#security) for production deployments.

### Running Igniter

| I am a...                                   | Start here                                                                                             |
|---------------------------------------------|--------------------------------------------------------------------------------------------------------|
| **Developer** contributing to Igniter       | Use [Tilt](https://tilt.dev/) — run `tilt up` from the repo root for a full local dev environment      |
| **Provider or Delegator** deploying Igniter | Use [Docker Compose](docker-compose/README.md) — production-ready deployment with per-app setup guides |

Each app also has its own README with environment variables, database migrations, and configuration details:

- [Provider README](apps/provider/README.md)
- [Middleman README](apps/middleman/README.md)

---

## Guides

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

## Contributing

Bug reports and feature requests go to [GitHub Issues](https://github.com/pokt-network/igniter/issues).

See the [Contributing Guide](CONTRIBUTING.md) for development setup, coding conventions, and how to submit a pull request.

---

## Funded By

<a href="https://pocket.network">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/pocket-network-logo-white.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/pocket-network-logo.png">
    <img alt="Pocket Network Foundation" src="docs/assets/pocket-network-logo.png" width="200">
  </picture>
</a>

This project is funded by [Pocket Network Foundation](https://pocket.network).
