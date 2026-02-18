# Running Igniter with Docker Compose

##  Security & Usage Notice

This repository contains a **demonstration setup** for running the Igniter tooling locally or in a controlled environment.  
It is **not production-ready** as provided.

If deploying beyond local testing, you **must**:

- **Secure Temporal UI** – The included `temporal-ui` service runs **without authentication** by default. If exposed publicly, anyone could control workflows.  
  → Follow [Temporal Web UI Auth Docs](https://docs.temporal.io/references/web-ui-configuration#auth) to enable authentication.

- **Restrict network access** – Do not expose service ports to the internet. Bind to `127.0.0.1`, internal networks, or place behind a firewall/reverse proxy.

- **Protect sensitive data** – `.env` files store private keys, encryption keys, and database credentials.  
  → Never commit them to Git. Store securely.

- **Use TLS/HTTPS** – For any exposed endpoints, enable encryption.

> **Note:** Igniter apps themselves include authentication — the above warning applies **only** to `temporal-ui`.

---

## 1. Dependencies (`docker-compose/dependencies/docker-compose.yaml`)

This stack provides shared services required by both **provider** and **middleman**:

- **PostgreSQL** – primary database  
- **Temporal** – workflow orchestration backend  
- **Temporal Admin Tools** – CLI for managing workflows  
- **Temporal UI** – workflow web interface (**no auth by default** – secure it!)  
- **Workflow Setup** – initialization script for namespaces and queues

**.env setup:**
```bash
cp docker-compose/dependencies/.env.sample docker-compose/dependencies/.env
```
Set:
- PostgreSQL credentials (`POSTGRES_PASSWORD`)  

---

## 2. Provider (`docker-compose/apps/provider/docker-compose.yaml`)

Runs:
- `provider-migration` – applies DB migrations  
- `provider-web` – provider admin web interface  
- `provider-workflows` – background workflows and activities

**.env setup:**
```bash
cp docker-compose/apps/provider/.env.sample docker-compose/apps/provider/.env
```
Key variables:
- `TEMPORAL_NAMESPACE=provider`  
- DB credentials matching **dependencies**  
- `POKT_RPC_URL` – RPC endpoint  
- `OWNER_IDENTITY`, `OWNER_EMAIL`, `APP_IDENTITY` – Pocket Network identity  
- Encryption keys/secrets (generate with `openssl rand -hex ...`)

---

## 3. Middleman (`docker-compose/apps/middleman/docker-compose.yaml`)

Runs:
- `middleman-migration` – applies DB migrations  
- `middleman-web` – middleman web interface  
- `middleman-workflows` – background workers

**.env setup:**
```bash
cp docker-compose/apps/middleman/.env.sample docker-compose/apps/middleman/.env
```
Key variables:
- `TEMPORAL_NAMESPACE=middleman`  
- DB credentials matching **dependencies**  
- `POKT_RPC_URL` – RPC endpoint  
- `OWNER_IDENTITY`, `OWNER_EMAIL`, `APP_IDENTITY`  
- Optional: `COIN_MARKET_CAP_API_KEY`

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

### Example governance JSON for **middleman** (in `pocket-beta/middleman.json`):

```jsonc
{
  "role": "middleman",
  "owner_identity": "pokt1xyz...",
  "owner_email": "alice@example.com",
  "app_identity": "abcdef123456..."
  // Add any other required metadata...
}
```

### Example governance JSON for **provider** (in `pocket/provider.json`):

```jsonc
 {
    "name": "<entity-name>",
    "identity": "<secp256k1-hex-public-key>",
    "identityHistory": [],
    "url": "<public-api-url>"
  },
```

### Example governance JSON for **middleman** (in `pocket/middleman.json`):

```jsonc
 {
    "name": "<entity-name>",
    "identity": "<secp256k1-hex-public-key>",
    "identityHistory": []
  },
```

#### Steps:
1. Fork [pokt-network/governace](https://github.com/pokt-network/igniter-governance).  
2. In the appropriate network folder (e.g. `pocket-beta/`), add your JSON file:
   - Copy one of the above examples and replace the placeholder values with your data.  
3. Submit a PR.  
4. Once merged, the opposite role will be able to allow you to work with.
