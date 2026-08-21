[Back to Igniter documentation](../README.md)

# Running Igniter with Docker Compose

## Security & Usage Notice

This repository contains a **demonstration setup** for running the Igniter tooling locally or in a controlled environment.
It is **not production-ready** as provided.

**Before starting any service**, set a strong PostgreSQL password in `docker-compose/dependencies/.env`:

```bash
cp docker-compose/dependencies/.env.sample docker-compose/dependencies/.env
```

Then edit the file and set `POSTGRES_PASSWORD` to a strong, unique value. This same password must be set as `PGPASSWORD` in both the provider and middleman `.env` files. **Do not skip this step** — the dependencies stack will not start without it, and the applications will fail to connect to the database if the passwords do not match.

If deploying beyond local testing, you **must** also:

- **Secure Temporal UI** — The included `temporal-ui` service runs **without authentication** by default. If exposed publicly, anyone could control workflows.
  Follow [Temporal Web UI Auth Docs](https://docs.temporal.io/references/web-ui-configuration#auth) to enable authentication.

- **Restrict network access** — Do not expose service ports to the internet. Bind to `127.0.0.1`, internal networks, or place behind a firewall/reverse proxy.

- **Protect sensitive data** — `.env` files store private keys, encryption keys, and database credentials.
  Never commit them to Git. Store securely.

- **Use TLS/HTTPS** — For any exposed endpoints, enable encryption.

### Exposing Provider API for Middleman Communication

The **Middleman** application needs to reach the **Provider** API over the network. However, the Provider also serves an admin web interface that **must not** be publicly accessible.

When deploying, place a **reverse proxy** (nginx, Caddy, Traefik, etc.) in front of the Provider and forward only the paths below:

| Method | Path | Purpose |
|--------|------|---------|
| `GET`  | `/api/identity` | Governance attestation — echoes the public key derived from `APP_IDENTITY` |
| `POST` | `/api/status` | Get provider configuration and status |
| `POST` | `/api/suppliers` | Get supplier stake configurations |
| `POST` | `/api/suppliers/stake` | Mark suppliers as staked |
| `POST` | `/api/suppliers/unstaking` | Mark suppliers as unstaking |
| `POST` | `/api/suppliers/release` | Release suppliers from staking |
| `POST` | `/api/suppliers/address-groups` | Resolve staked addresses back to their address groups |
| `POST` | `/api/import-suppliers/request` | Initiate supplier import (returns nonce) |
| `POST` | `/api/import-suppliers/submit` | Submit import with owner signature |
| `POST` | `/api/import-suppliers/status` | Check import request status |

Every other route **must be blocked** from public access — including three that are easy to forward by accident because they also live under `/api/`:

- `/api/rpc/*` — an unauthenticated pass-through proxy to your Pocket API node, used only by the admin UI. Publicly exposed, anyone can relay arbitrary requests through your node.
- `/api/health` — runs a database query per request; it is a container liveness probe for the internal network.
- `/api/bootstrap` — bootstrap status; nothing outside the instance calls it.

Along with `/`, `/admin/*`, `/api/auth/*`, `/_next/*`, and any server action paths. Allowlist individual paths, never the `/api/` prefix.

These API endpoints are authenticated using cryptographic signatures (`X-Middleman-Identity` and `X-Middleman-Signature` headers) — they do not rely on browser sessions or cookies.

> **Summary:** Middleman = public-facing (expose everything). Provider = internal admin tool (expose **only** the API paths listed above).

For a complete default-deny nginx configuration, how to keep the admin portal reachable for yourself, and commands to verify the result, see the [Exposing the Provider API guide](../docs/guides/provider/expose-api.md).

---

## 1. Dependencies (`docker-compose/dependencies/docker-compose.yaml`)

This stack provides shared services required by both **provider** and **middleman**:

- **PostgreSQL** — primary database
- **Temporal** — workflow orchestration backend
- **Temporal Admin Tools** — CLI for managing workflows
- **Temporal UI** — workflow web interface (**no auth by default** — secure it!)
- **Workflow Setup** — initialization script for namespaces and queues

**.env setup:**
```bash
cp docker-compose/dependencies/.env.sample docker-compose/dependencies/.env
```
Set:
- PostgreSQL credentials (`POSTGRES_PASSWORD`)

---

## 2. Provider (`docker-compose/apps/provider/docker-compose.yaml`)

Runs:
- `provider-migration` — applies DB migrations
- `provider-web` — provider admin web interface
- `provider-workflows` — background workflows and activities

**.env setup:**
```bash
cp docker-compose/apps/provider/.env.sample docker-compose/apps/provider/.env
```
Key variables:
- `TEMPORAL_NAMESPACE=provider`
- DB credentials matching **dependencies**
- `POKT_RPC_URL` — CometBFT RPC endpoint (seeded into DB on first boot)
- `OWNER_IDENTITY`, `OWNER_EMAIL`, `APP_IDENTITY` — Pocket Network identity
- Encryption keys/secrets (generate with `openssl rand -hex ...`)

For the complete environment variable reference, see the [Provider Setup Guide](../apps/provider/README.md).

---

## 3. Middleman (`docker-compose/apps/middleman/docker-compose.yaml`)

Runs:
- `middleman-migration` — applies DB migrations
- `middleman-web` — middleman web interface
- `middleman-workflows` — background workers

**.env setup:**
```bash
cp docker-compose/apps/middleman/.env.sample docker-compose/apps/middleman/.env
```
Key variables:
- `TEMPORAL_NAMESPACE=middleman`
- DB credentials matching **dependencies**
- `POKT_RPC_URL` — CometBFT RPC endpoint (seeded into DB on first boot)
- `OWNER_IDENTITY`, `OWNER_EMAIL`, `APP_IDENTITY`
- Optional: `COIN_MARKET_CAP_API_KEY`

For the complete environment variable reference, see the [Middleman Setup Guide](../apps/middleman/README.md).

---

## 4. Important Notes

- You **must** have a `.env` file for each stack, even if values repeat.
- Start **dependencies** first:
  ```bash
  cd docker-compose/dependencies
  docker compose up -d
  ```
- Then start `provider` or `middleman`:
  ```bash
  cd docker-compose/apps/provider   # or docker-compose/apps/middleman
  docker compose up -d
  ```
- If running only one of them, **dependencies** is still required.
- Check available docker images here: [pokt-network/packages](https://github.com/pokt-network/igniter/packages)

---

## 5. Registering as a Provider or Middleman

To participate in the network, you must submit a Pull Request adding yourself under the right role.

### Example governance JSON for **provider** (in `pocket/provider.json`):

```jsonc
{
  "name": "<entity-name>",
  "identity": "<secp256k1-hex-public-key>",
  "identityHistory": [],
  "url": "<public-api-url>"
}
```

### Example governance JSON for **middleman** (in `pocket/middleman.json`):

```jsonc
{
  "name": "<entity-name>",
  "identity": "<secp256k1-hex-public-key>",
  "identityHistory": []
}
```

For testnet (`pocket-beta`), use the same structure in the `pocket-beta/` folder.

#### Steps:
1. Fork [pokt-network/igniter-governance](https://github.com/pokt-network/igniter-governance).
2. In the appropriate network folder (e.g. `pocket-beta/`), add your JSON file:
   - Copy one of the above examples and replace the placeholder values with your data.
3. Submit a PR.
4. Once merged, the opposite role will be able to allow you to work with.

---

**See also:** [Igniter README](../README.md) · [Contributing Guide](../CONTRIBUTING.md)
