# Development Setup

This guide walks through setting up a local Igniter development environment using Tilt and Kubernetes.

> **Note:** Docker Compose files in `docker-compose/` are for **production deployment**, not for development. See the [Docker Compose README](docker-compose/README.md) for deployment instructions.

---

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 10.15.0 — install with `npm install -g pnpm`
- **Docker** — required for building container images and running the local cluster
- **[Tilt](https://tilt.dev/)** — manages the local development environment
- **A local Kubernetes cluster** — The included cluster script uses [kind](https://kind.sigs.k8s.io/), but [k3d](https://k3d.io/) or similar tools also work
- **A Pocket Network wallet** — You need a wallet with an address, public key, and private key for configuring the apps. For signing in to the web UI, install [Soothe Wallet](https://trustsoothe.io/) or [Keplr Wallet](https://www.keplr.app/) as a browser extension (Chrome or Firefox)

---

## 1. Clone and install

```bash
git clone https://github.com/pokt-network/igniter.git
cd igniter
pnpm install
```

---

## 2. Create the local cluster

The project includes a script that creates a kind cluster with a local container registry on port 5001:

```bash
pnpm create-cluster
```

This only needs to run once. It creates:
- A kind Kubernetes cluster
- A local Docker registry (`kind-registry` on `localhost:5001`)
- Network connectivity between the registry and the cluster

The local registry is key for the development workflow. Without it, kind would need to pull images from an external registry or have them side-loaded on every change. With a local registry, Tilt pushes built images directly to `localhost:5001` and the cluster pulls them over the local network — no external calls. Docker image layers are cached in the registry, so only changed layers need to be pushed and pulled on each rebuild. This makes the build-deploy-test cycle significantly faster, especially for incremental changes where most layers remain unchanged.

---

## 3. Configure the environment

Copy the sample environment file and fill in your values:

```bash
cp .env.sample .env
```

The `.env` file at the repo root is **required** — Tilt reads it on startup and will fail if identity variables are missing.

### Identity variables

Both apps require identity keys to operate. You need a Pocket Network wallet with an address, public key, and private key.

| Variable | Description |
|----------|-------------|
| `MIDDLEMAN_OWNER_IDENTITY` | Owner address for the Middleman app |
| `MIDDLEMAN_APP_IDENTITY` | Private key used by Middleman to sign requests to Provider |
| `PROVIDER_OWNER_IDENTITY` | Owner address for the Provider app |
| `PROVIDER_APP_IDENTITY` | Private key used by Provider to sign responses to Middleman |

### Governance variables

In dev, a local nginx serves governance JSON files so the apps can discover each other (replicating what [igniter-governance](https://github.com/pokt-network/igniter-governance) does in production).

Sample files are provided under `k8s/tools/governance/`. Copy them and update the `identity` fields with your actual public keys:

```bash
cp k8s/tools/governance/delegators.sample.json k8s/tools/governance/delegators.json
cp k8s/tools/governance/providers.sample.json k8s/tools/governance/providers.json
```

The `.json` files are gitignored, so your local configuration won't be committed.

The `.env.sample` already points to these file paths by default. You can alternatively use inline JSON via `DELEGATOR_JSON` / `PROVIDER_JSON` instead of the file path variables, but not both at the same time.

| Variable | Description |
|----------|-------------|
| `DELEGATOR_JSON` | Inline JSON array of delegators (consumed by Provider) |
| `DELEGATOR_JSON_FILE` | Path to a delegator JSON file (consumed by Provider) |
| `PROVIDER_JSON` | Inline JSON array of providers (consumed by Middleman) |
| `PROVIDER_JSON_FILE` | Path to a provider JSON file (consumed by Middleman) |

### Auto-bootstrap (optional)

By default, both apps require completing a setup wizard on first launch. For faster dev iterations, you can skip the wizard by providing a bootstrap config file.

1. Copy the example config and adjust values:

```bash
# Provider
cp k8s/apps/provider/overlays/dev/bootstrap.example.json \
   k8s/apps/provider/overlays/dev/bootstrap.json

# Middleman
cp k8s/apps/middleman/overlays/dev/bootstrap.example.json \
   k8s/apps/middleman/overlays/dev/bootstrap.json
```

2. Add the bootstrap paths to your `.env`:

```bash
PROVIDER_BOOTSTRAP_CONFIG_PATH=../overlays/dev/bootstrap.json
MIDDLEMAN_BOOTSTRAP_CONFIG_PATH=../overlays/dev/bootstrap.json
```

When these variables are set, Tilt injects an init container that seeds the database before the app starts. The seed script:
- Is **idempotent** — if the app is already bootstrapped, it skips
- Fetches **minimum stake** and **current height** from the Pocket API at runtime (not hardcoded)
- Fetches **delegators** (for Provider) and **providers** (for Middleman) from the governance CDN
- Derives the **app identity** (compressed public key) from the `APP_IDENTITY` private key

The `bootstrap.json` files are gitignored. The `.example.json` files are committed as templates.

> **Important:** The governance files (`k8s/tools/governance/providers.json` and `delegators.json`) must be configured first — the bootstrap seed fetches from them via the governance nginx CDN.

### Other variables

| Variable | Description |
|----------|-------------|
| `LOCALNET_ENABLED` | Set to `true` to spin up a local Pocket Network validator (pocketd) with pre-funded accounts and pre-staked suppliers. Also sets `POKT_RPC_URL` to `http://validator:26657` in the workflow configmaps and adds `owner-fund` as a dependency for both apps. Required for local end-to-end testing |
| `MINIMUM_STAKE_BUFFER` | Buffer in uPOKT added to on-chain minimum stake (default: `500000000`) |
| `PROVIDER_BOOTSTRAP_CONFIG_PATH` | Path to provider bootstrap JSON (relative to Tiltfile). Enables auto-bootstrap when set |
| `MIDDLEMAN_BOOTSTRAP_CONFIG_PATH` | Path to middleman bootstrap JSON (relative to Tiltfile). Enables auto-bootstrap when set |

---

## 4. Start the environment

```bash
tilt up
```

Tilt will build all container images, deploy them to the local cluster, and start watching for file changes. The Tilt UI opens in your browser and shows the status of all resources.

### Services and ports

| Service | URL | Description |
|---------|-----|-------------|
| Provider | http://localhost:3001 | Operator-facing app |
| Middleman | http://localhost:3000 | Delegator-facing app |
| Temporal UI | http://localhost:8080 | Workflow monitoring |
| pgAdmin | http://localhost:5050 | Database management (user: `igniter@tilt-dev.com`, pass: `igniter`) |
| PostgreSQL | localhost:5432 | Direct database access |

### Signing in

Both apps use **SIWP (Sign-In with Pocket)** for authentication. You need a browser wallet extension to sign in:

- [Soothe Wallet](https://trustsoothe.io/) (Chrome / Firefox)
- [Keplr Wallet](https://www.keplr.app/) (Chrome / Firefox)

Configure your wallet with the same account you used for the identity variables in `.env`.

---

## Useful commands

### Database migrations

```bash
# Generate a new migration for Provider
pnpm provider:migration:generate

# Run Provider migrations
pnpm provider:migration:migrate

# Generate a new migration for Middleman
pnpm middleman:migration:generate

# Run Middleman migrations
pnpm middleman:migration:migrate
```

### Formatting

```bash
pnpm format
```

### Building

```bash
# Build all apps and packages
pnpm build

# Build a specific Docker image
pnpm build:provider:docker
pnpm build:middleman:docker
pnpm build:provider-workflows:docker
pnpm build:middleman-workflows:docker
```
