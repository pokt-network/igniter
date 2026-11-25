[Back to Igniter documentation](../README.md)

# Running Igniter with Docker Compose

## Security & Usage Notice

> [!CAUTION]
> **DISCLAIMER: example configuration only.**
> Everything under `docker-compose/` (the compose files, `.env.sample` files, init scripts and the instructions on this page) is an **example**, provided "as is", without warranty of any kind.
> It runs the dependencies and both apps on one host only so the whole system can be shown in one place. A real deployment runs **either** a provider **or** a middleman, not both.
> **You are solely responsible for the security of your own deployment**: network exposure, firewalling and egress, TLS, secrets and key management, database and Temporal access control, backups, and upgrades.
> Review and harden it for your environment before using it with real keys or funds. The Igniter maintainers are not responsible for any loss, compromise or damage resulting from deploying this example as is, or from your own configuration.

This repository contains a **demonstration setup** for running the Igniter tooling locally or in a controlled environment.
It is **not production-ready** as provided.

**Before starting any service**, set the PostgreSQL passwords in `docker-compose/dependencies/.env`:

```bash
cp docker-compose/dependencies/.env.sample docker-compose/dependencies/.env
```

Then edit the file and set the four passwords, each to its own value (`openssl rand -hex 32`). Compose refuses to start while any of them is empty.

| Variable | Role | Used by |
|---|---|---|
| `POSTGRES_PASSWORD` | `igniter`, the bootstrap superuser | Nobody but you. Never put it in an app `.env`. |
| `MIDDLEMAN_DB_PASSWORD` | `middleman`, owner of database `middleman` | `PGPASSWORD` in `apps/middleman/.env` (with `PGUSER="middleman"`) |
| `PROVIDER_DB_PASSWORD` | `provider`, owner of database `provider` | `PGPASSWORD` in `apps/provider/.env` (with `PGUSER="provider"`) |
| `TEMPORAL_DB_PASSWORD` | `temporal`, owner of `temporal` and `temporal_visibility` | The Temporal server only |

`postgresql/init-roles.sh` creates the roles and databases on a fresh volume. No role is a superuser, and none can connect to another role's database. **Existing installs:** the script does not run on its own; see [Upgrading an existing install](#upgrading-an-existing-install).

If deploying beyond local testing, you **must** also:

- **Keep Temporal private** — Temporal has no authentication in this setup: anyone who reaches gRPC `:7233` can read and control every workflow, in both namespaces. The `temporal-ui` and `temporal-admin-tools` services are off by default (compose profile `debug`); start them only when you need them (`docker compose --profile debug up -d`), and never expose port `8080`. To put auth on the UI, follow the [Temporal Web UI Auth Docs](https://docs.temporal.io/references/web-ui-configuration#auth).

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

> **Summary:** Middleman = public-facing delegator UI, published through a reverse proxy that blocks its internal paths (see [Hardening](#hardening-a-deployment)). Provider = internal admin tool (expose **only** the API paths listed above). In both cases, only the web app's port goes behind the proxy. PostgreSQL, Temporal (`7233`, and the HTTP API, which is disabled) and the Temporal UI are never exposed.

For a complete default-deny nginx configuration, how to keep the admin portal reachable for yourself, and commands to verify the result, see the [Exposing the Provider API guide](../docs/guides/provider/expose-api.md).

---

## Hardening a deployment

The compose files ship with these defaults. Keep them when you adapt the files:

- **One network per app stack.** The dependencies stack creates `igniter-middleman` and `igniter-provider`, both `internal` (no route off the host). PostgreSQL and Temporal also sit on `igniter-host-access`, a plain bridge whose only job is the `127.0.0.1` port publishes. That bridge does give them outbound internet. If you do not need host-side `psql` or `temporal` access, delete that network and the `ports:` entries from `dependencies/docker-compose.yaml`. Each app stack joins only its own network, plus a private `igniter-<app>-egress` network for outbound traffic. The stacks cannot resolve each other's container names, and neither can reach the other's backend network. There is one exception, measured with Docker 29: a container that publishes a port (the web apps, on `127.0.0.1`) can still be reached by its egress-network IP from the other stack's containers. The egress rules below close that path.
- **One Temporal server for both stacks.** It serves the `middleman` and `provider` namespaces, and Temporal does not authorize per namespace. Any container that reaches `temporal:7233` can use both. If one host runs both apps and that matters to you, run each app with its own dependencies stack on a separate host.
- **The Temporal HTTP API is off** (`FRONTEND_HTTP_PORT=0`), so no `:7243` listener exists. Igniter only uses gRPC (`:7233`).
- **Only the bootstrap superuser is a superuser.** Each app connects as its own role, which owns only its own database.
- **Images are pinned** through `IGNITER_VERSION` in each app's `.env`. Bump it on every upgrade, and never use `latest`. To pin the exact image bytes, use `IGNITER_VERSION=<version>@sha256:<digest>`.
- **Every published port binds to `127.0.0.1`.** That includes the web app ports, so put the reverse proxy on the same host.

### Middleman: what to expose

Middleman is the public delegator site, so its web UI goes behind the proxy: `/`, `/app/*`, `/admin/*`, `/auth/*`, `/api/auth/*`, `/_next/*`, plus the server-action POSTs to those page paths. Block these paths at the proxy:

- `/api/health`, the container liveness probe. It runs a database query per request.
- `/api/bootstrap`, the bootstrap status. Nothing outside the instance calls it.

`/api/rpc/*` and `/api/provider-rpc` must stay reachable: the browser calls them (`/api/rpc` from the wallet connection, `/api/provider-rpc` from the client services in `src/lib/services/provider.ts` and `importSuppliers.ts`). They are server-side proxies, and that is one more reason to apply the egress rules below.

The admin area (`/admin/*`) is used only by the owner wallet. If you can, restrict it to your own IPs or a VPN.

### The reverse proxy and forwarded headers

`AUTH_TRUST_HOST` has no effect. Both apps hardcode `trustHost: true` (`apps/*/src/auth.config.ts`), so they always trust `X-Forwarded-Host` and `X-Forwarded-Proto`. Your proxy must therefore **set** those headers itself and drop any value a client sends. For nginx:

```nginx
proxy_set_header Host              $host;
proxy_set_header X-Forwarded-Host  $host;
proxy_set_header X-Forwarded-Proto $scheme;
```

Nothing may reach the app port except through the proxy.

### Egress: deny internal destinations

The web and worker containers make outbound requests to the chain RPC/API, the governance CDN, provider URLs, price feeds and notification channels. Some of those URLs are configurable. Deny anything internal at the host, so a request steered at a private address goes nowhere. The egress networks have fixed bridge names (`ign-mm-egress`, `ign-pv-egress`) for this purpose. As root, for each bridge:

```bash
# UNTESTED: written for this guide and not run against a live host.
# Review it for your own network first, and save it with your firewall tooling
# (iptables-persistent, nftables, ...), because Docker does not persist DOCKER-USER rules.
for BR in ign-mm-egress ign-pv-egress; do
  for NET in 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 100.64.0.0/10 169.254.0.0/16 127.0.0.0/8; do
    iptables -I DOCKER-USER -i "$BR" ! -o "$BR" -d "$NET" -j DROP
  done
done
```

The backend networks are separate bridges, so this does not cut the app off from PostgreSQL and Temporal. If your Pocket node, RPC endpoint or SMTP server sits on a private address, add an `ACCEPT` rule for that exact address **above** the drops (`iptables -I` inserts at the top, so add the ACCEPT last). Also set `NOTIFICATION_EGRESS_ALLOWLIST` for it.

On a cloud VM, also block the instance metadata service (`169.254.169.254`, covered above) or require IMDSv2 with a hop limit of 1.

---

## Upgrading an existing install

Installs created before the per-stack networks and the per-database roles need these steps once. `init-roles.sh` only runs on its own against an empty volume. Your data stays in place: the script creates the roles, then transfers ownership of the existing databases and every table, sequence, type and schema in them.

1. **Update the `.env` files first.** The new compose files refuse to start (`up`) until these values are set.
   - In `dependencies/.env`, keep `POSTGRES_USER` and `POSTGRES_PASSWORD` as they are. Add `MIDDLEMAN_DB_PASSWORD`, `PROVIDER_DB_PASSWORD` and `TEMPORAL_DB_PASSWORD` (see `.env.sample`).
   - In each app `.env`, set `IGNITER_VERSION`, `PGUSER` (`middleman` or `provider`) and `PGPASSWORD` (the matching `*_DB_PASSWORD`). Remove `AUTH_TRUST_HOST`, which has no effect.
2. **Stop the app stacks.** In `docker-compose/apps/middleman` and/or `docker-compose/apps/provider`, run:
   ```bash
   docker compose down
   ```
3. **Stop the dependencies stack and remove the old shared network.** In `docker-compose/dependencies`, run:
   ```bash
   docker compose --profile debug down --remove-orphans  # also stops the old temporal-ui / admin-tools
   docker network rm igniter                             # the old shared network; the new files no longer define it
   ```
4. **Start PostgreSQL, run the role script once, then start the rest:**
   ```bash
   docker compose up -d --wait postgresql
   docker compose exec postgresql /docker-entrypoint-initdb.d/init-roles.sh
   docker compose up -d --wait                           # Temporal now connects as role `temporal`
   ```
   The script is idempotent, and re-running it is safe. It also resets the three role passwords to the values in `.env`.
5. **Start the app stacks:** run `docker compose up -d` in each app folder.
6. **Rotate the superuser password.** Before this upgrade, every app `.env` carried it, so treat it as exposed. Nothing but you uses it now:
   ```bash
   docker compose exec postgresql psql -U igniter -d postgres -c "ALTER ROLE igniter PASSWORD '<new password>'"
   ```
   Then put the new value in `POSTGRES_PASSWORD`.

Temporal keeps its history and schedules, because it uses the same `temporal` and `temporal_visibility` databases, now owned by role `temporal`.

To do the same by hand on an external PostgreSQL, run the SQL that the script issues, once per role and database, as a superuser:

```sql
CREATE ROLE middleman LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '<password>';
ALTER DATABASE middleman OWNER TO middleman;
REVOKE ALL ON DATABASE middleman FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE middleman TO middleman;
-- then, connected to database middleman: ALTER ... OWNER TO middleman for every
-- schema (drizzle), table, sequence, enum type and function.
```

`REASSIGN OWNED BY igniter TO middleman` does not work here. The bootstrap superuser also owns system objects, so PostgreSQL refuses it. The script's `DO` block does the per-object `ALTER ... OWNER` instead.

---

## 1. Dependencies (`docker-compose/dependencies/docker-compose.yaml`)

This stack provides shared services required by both **provider** and **middleman**:

- **PostgreSQL** — primary database
- **Temporal** — workflow orchestration backend
- **Temporal Admin Tools** — CLI for managing workflows (profile `debug`, off by default)
- **Temporal UI** — workflow web interface (profile `debug`, off by default; **no auth**: never expose it)
- **Workflow Setup** — initialization script for namespaces and queues

**.env setup:**
```bash
cp docker-compose/dependencies/.env.sample docker-compose/dependencies/.env
```
Set:
- PostgreSQL passwords (`POSTGRES_PASSWORD`, `MIDDLEMAN_DB_PASSWORD`, `PROVIDER_DB_PASSWORD`, `TEMPORAL_DB_PASSWORD`)

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
- `IGNITER_VERSION`: the image version to run (bump on every upgrade)
- `TEMPORAL_NAMESPACE=provider`
- `PGUSER="provider"`, and `PGPASSWORD` equal to `PROVIDER_DB_PASSWORD` in **dependencies**
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
- `IGNITER_VERSION`: the image version to run (bump on every upgrade)
- `TEMPORAL_NAMESPACE=middleman`
- `PGUSER="middleman"`, and `PGPASSWORD` equal to `MIDDLEMAN_DB_PASSWORD` in **dependencies**
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
- Check available docker images here: [pokt-network/packages](https://github.com/pokt-network/igniter/packages). The samples pin `IGNITER_VERSION` to a release; set it to the release you are installing.
- If one host runs both apps, Middleman still reaches the Provider through the Provider's public URL from governance, never through a Docker network. The two stacks share no network.

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
