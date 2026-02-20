# Contributing to Igniter

Bug reports, feature requests, and documentation improvements are welcome. Open an issue on [GitHub Issues](https://github.com/pokt-network/igniter/issues) to start a discussion, or jump straight to a pull request for small fixes.

By submitting a pull request, you agree that your contributions will be licensed under the project's existing license terms.

---

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 10.15.0 — install with `npm install -g pnpm`
- **Docker** and **Docker Compose** (v2+) — required for running dependencies locally
- **[Tilt](https://tilt.dev/)** — optional, but recommended for the full local k8s dev environment

---

## Development Setup

### Clone and install

```bash
git clone https://github.com/pokt-network/igniter.git
cd igniter
pnpm install
```

### Option A: Tilt (recommended for full-stack development)

Tilt manages the full local development environment — apps, workers, database, and Temporal — using Kubernetes. A `Tiltfile` at the repo root wires everything together.

```bash
# Start all services (requires a local k8s cluster — see tilt/ for cluster setup)
tilt up
```

The `tilt/` directory contains Tiltfiles for each app and its workflow worker. Use `tilt/docker/cluster.sh` (via `pnpm create-cluster`) to create the local cluster before first run.

### Option B: Docker Compose (standalone)

For running just the dependencies (PostgreSQL + Temporal) without Kubernetes:

```bash
cd docker-compose/dependencies
cp .env.sample .env
# Edit .env to set POSTGRES_PASSWORD
docker compose up -d
```

Then run the apps individually. See each app's README for environment variable setup:

- [Provider Setup](apps/provider/README.md)
- [Middleman Setup](apps/middleman/README.md)

For the full Docker Compose deployment guide — including Provider and Middleman services — see the [Docker Compose README](docker-compose/README.md).

### Run all apps (development mode)

```bash
pnpm dev
```

This uses Turborepo to start all apps and workers in parallel.

---

## Project Structure

```
igniter/
├── apps/           # Provider (operator UI) and Middleman (delegator UI), plus their Temporal workers
├── packages/       # Shared libraries: UI components, database, Temporal definitions, Pocket SDK, logging
├── docker-compose/ # Deployment compose files (dependencies, provider, middleman)
├── tilt/           # Tilt configuration for local k8s development
└── docs/           # Architecture diagrams, guides, and admin workflow documentation
```

Both `apps/provider` and `apps/middleman` share the same stack: Next.js for the web app, Temporal for background workflow processing, PostgreSQL (via Drizzle ORM) for persistence, and SIWP (Sign-In with Pocket) for authentication.

---

## Coding Conventions

- **TypeScript** throughout — no plain JavaScript files
- **Prettier** for formatting — run `pnpm format` before committing
- **Drizzle ORM** for all database access — schema lives in `packages/@repo/db`
- **Shared packages** for cross-app concerns — add to `packages/` rather than duplicating in each app
- No new `any` types without a justifying comment

---

## Commit Messages

This project uses **Conventional Commits**:

```
type(scope): short description
```

**Types:** `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

**Scope:** the app or package name (`provider`, `middleman`, `db`, `ui`, `temporal`, etc.)

**Examples:**

```
feat(provider): add relay miner health check endpoint
fix(middleman): handle null rewards in overview dashboard
docs(provider): document bootstrap wizard steps
chore(db): update drizzle-kit to 0.31.4
```

Keep the subject line under 72 characters. Use the body for context if needed.

---

## Branch Naming

Use kebab-case with a type prefix:

| Type | Pattern | Example |
|------|---------|---------|
| New feature | `feature/description` | `feature/provider-re-stake` |
| Bug fix | `bug/description` | `bug/187-rpc-type-validation` |
| Documentation | `docs/description` | `docs/contributing-guide` |

Branch from `main` for all contributions.

---

## Pull Requests

1. Fork the repo and create a branch from `main`
2. Make your changes — keep PRs focused on a single concern
3. Run `pnpm format` and confirm TypeScript compiles (`pnpm build`)
4. Open a PR against `main` with a clear description of what and why

Keep PRs small. Focused pull requests are easier to review and faster to merge.
