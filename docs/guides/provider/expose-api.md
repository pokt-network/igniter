[< Back to Provider documentation](../../../apps/provider/README.md)

# Exposing the Provider API

## Why this guide exists

The Provider app serves two very different things on the same port:

- an **admin portal** (`/`, `/admin/*`) — an internal operator tool, protected only by a wallet sign-in;
- a **machine API** (a small set of `/api/*` paths) — how Middleman instances and the governance registry reach you.

Only the second one needs to be on the public internet. This guide lists exactly which paths that is, gives a default-deny nginx configuration, and shows how to verify it.

> **You do not need to expose the portal base path.** Nothing outside your organization ever requests `/`. Middleman only ever builds URLs as `<your registry url> + /api/...`, and governance validation reads `/api/identity`. A public `GET /` may return `404` — everything keeps working.

---

## What must be reachable from the public internet

| Method | Path | Called by | Purpose |
|--------|------|-----------|---------|
| `GET`  | `/api/identity` | Governance CI | Attestation — echoes the public key derived from your `APP_IDENTITY` |
| `POST` | `/api/status` | Middleman workflows | Provider configuration and health for the delegator |
| `POST` | `/api/suppliers` | Middleman app | Fetch supplier stake configurations (accepts `?simulate=true`) |
| `POST` | `/api/suppliers/stake` | Middleman workflows | Mark suppliers as staked |
| `POST` | `/api/suppliers/unstaking` | Middleman workflows | Mark suppliers as unstaking |
| `POST` | `/api/suppliers/release` | Middleman app + workflows | Release suppliers from staking |
| `POST` | `/api/suppliers/address-groups` | Middleman workflows | Resolve staked addresses back to their address groups |
| `POST` | `/api/import-suppliers/request` | Middleman app | Start a supplier import (returns a nonce) |
| `POST` | `/api/import-suppliers/submit` | Middleman app | Submit an import with the owner signature |
| `POST` | `/api/import-suppliers/status` | Middleman app + workflows | Poll an import request |

That is the complete list. Every `POST` above is authenticated by signature — the `X-Middleman-Identity` and `X-Middleman-Signature` headers, validated against the delegators you enabled. None of them use a browser session or cookie.

`GET /api/identity` is unauthenticated by design: it returns a public key that is already published in the governance registry.

### No CORS is involved

A delegator's browser never talks to your Provider directly. Browser actions go to the Middleman server, which signs the payload and makes the request server-side; workflow traffic comes from the Middleman worker. Your proxy therefore does not need to answer `OPTIONS` preflights or emit `Access-Control-*` headers for any of the `POST` paths.

---

## What must stay private

| Path | Why it must not be public |
|------|---------------------------|
| `/` and `/admin/*` | The admin portal — key management, delegator configuration, bootstrap. Sign-in is the only barrier. |
| `/api/auth/*` | NextAuth sign-in, callback, and session endpoints for the portal. |
| `/_next/*`, `/favicon.ico`, and anything else from `public/` | Static assets and server-action endpoints for the portal. |
| `/api/rpc/*` | **An unauthenticated pass-through proxy to the Pocket API node configured in your settings.** It exists only for the portal's own UI. Publicly exposed, anyone can relay arbitrary requests through your node — burning your quota and using your instance for amplification. |
| `/api/health` | Runs a `SELECT 1` against your database on every request. It is a container liveness probe; keep it on the internal network. |
| `/api/bootstrap` | Reports whether bootstrap has completed. Nothing outside the instance calls it. |

> **The trap:** `/api/rpc/*`, `/api/health`, and `/api/bootstrap` all live under `/api/`. A configuration that forwards the whole `/api/` prefix exposes the open RPC proxy along with the endpoints you meant to publish. Allowlist individual paths, never the prefix.

---

## nginx configuration

This is a complete public edge. Everything not named is refused before it reaches the app.

Save the shared proxy settings once:

```nginx
# /etc/nginx/snippets/igniter-provider-proxy.conf

proxy_http_version 1.1;
proxy_set_header Connection        "";
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;

# The public API authenticates by signature, never by session. No cookie should
# cross this boundary in either direction.
proxy_set_header Cookie "";
proxy_hide_header Set-Cookie;

proxy_connect_timeout 5s;
proxy_read_timeout    60s;
```

Then the public server block:

```nginx
# /etc/nginx/conf.d/igniter-provider.conf

# Tune to your delegator count. Supplier operations arrive in bursts, so keep
# the burst allowance well above the steady rate.
limit_req_zone $binary_remote_addr zone=igniter_api:10m rate=10r/s;

# A separate zone for the attestation endpoint. Sharing one zone would let a
# burst of Middleman API calls exhaust the identity allowance and answer the
# governance check with 503.
limit_req_zone $binary_remote_addr zone=igniter_identity:1m rate=1r/s;

upstream igniter_provider {
    server 127.0.0.1:3001;
    keepalive 16;
}

server {
    listen 443 ssl;
    http2 on;
    server_name provider.example.com;

    ssl_certificate     /etc/letsencrypt/live/provider.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/provider.example.com/privkey.pem;

    # Signed payloads are small; this caps what a hostile body can cost you.
    client_max_body_size 1m;

    # Default deny. /, /admin/*, /api/auth/*, /_next/*, /api/rpc/*,
    # /api/health and /api/bootstrap all end here.
    location / {
        return 404;
    }

    # Governance attestation. Unauthenticated and read-only by design.
    location = /api/identity {
        limit_except GET { deny all; }
        limit_req zone=igniter_identity burst=5 nodelay;
        proxy_pass http://igniter_provider;
        include /etc/nginx/snippets/igniter-provider-proxy.conf;
    }

    # The Middleman API. Anchored regex — this matches these paths and nothing
    # else under /api/. A query string is not part of the match, so
    # /api/suppliers?simulate=true is covered.
    location ~ ^/api/(status|suppliers|suppliers/(stake|unstaking|release|address-groups)|import-suppliers/(request|submit|status))$ {
        limit_except POST { deny all; }
        limit_req zone=igniter_api burst=40 nodelay;
        proxy_pass http://igniter_provider;
        include /etc/nginx/snippets/igniter-provider-proxy.conf;
    }
}
```

Notes:

- **Leave `merge_slashes` at its default (`on`).** Some Middleman call sites join the registry URL and the path by concatenation, so a registry `url` recorded with a trailing slash produces `//api/suppliers/stake`. nginx normalizes that back to a single slash before matching locations; with `merge_slashes off` those requests would fall through to the deny block. Registering your `url` without a trailing slash avoids relying on this.
- **Bind the app to loopback.** The bundled compose file already publishes the port as `127.0.0.1:3001:3001`, so the proxy is the only way in. If you deploy differently, make sure port `3001` is not reachable from outside the host.
- **`APP_URL`, `AUTH_URL`, and `AUTH_TRUST_HOST` are app-level, not per-vhost.** None of the paths above use NextAuth, so this public hostname is irrelevant to them — point `APP_URL`/`AUTH_URL` at the *portal* entrance you actually sign in through (see below), and set `AUTH_TRUST_HOST=true` because the app sits behind a proxy either way.
- **`http2 on;` requires nginx 1.25.1 or newer.** On older builds (Debian 12 ships 1.22, Ubuntu 22.04 ships 1.18) write `listen 443 ssl http2;` and drop the separate directive.
- **`limit_req` is evaluated before `limit_except`.** A rate-limited request with the wrong method answers `503`, not `403`. That is cosmetic, but worth knowing when reading logs.

### Keeping the portal reachable for yourself

Serve it from a separate, private entrance — a second vhost on an internal interface, a VPN, an IP allowlist, or an SSH tunnel. For example:

```nginx
server {
    listen 10.0.0.5:443 ssl;          # private interface only
    server_name provider-admin.internal;

    ssl_certificate     /etc/nginx/certs/internal.crt;
    ssl_certificate_key /etc/nginx/certs/internal.key;

    allow 10.0.0.0/8;
    deny  all;

    location / {
        proxy_pass http://igniter_provider;
        include /etc/nginx/snippets/igniter-provider-proxy.conf;
        # The portal does need its session cookie.
        proxy_set_header Cookie $http_cookie;
        proxy_pass_header Set-Cookie;
    }
}
```

Set `APP_URL` and `AUTH_URL` to this internal hostname (`https://provider-admin.internal`) and `AUTH_TRUST_HOST=true`, so sign-in callbacks resolve against the entrance you actually use. They must match the portal entrance, not the public API hostname, or SIWP will redirect you somewhere unreachable.

The simplest alternative needs no second vhost at all: leave the app bound to `127.0.0.1:3001` and reach the portal over an SSH tunnel — `ssh -L 3001:127.0.0.1:3001 you@provider-host`, then open `http://localhost:3001`. In that setup `APP_URL` and `AUTH_URL` are `http://localhost:3001`.

---

## Governance registry

Your entry in [igniter-governance](https://github.com/pokt-network/igniter-governance) `provider.json` carries a `url`. That value is the **root** of your public entrance — governance validation appends `/api/identity` to it and compares the returned key against the `identity` in your pull request.

- Record `url` **without a trailing slash** (`https://provider.example.com`).
- The root itself is never fetched. It may return `404`.
- `/api/identity` derives the key from the `APP_IDENTITY` environment variable on every request. It does not read the database and does not require bootstrap to have completed, so it answers correctly on a freshly deployed instance and stays correct after a key rotation.
- If it returns `500 {"error":"Identity unavailable"}`, `APP_IDENTITY` is missing or malformed in the environment of the running container.

---

## Verify the configuration

From **outside** your network, against your public hostname:

```bash
BASE=https://provider.example.com

# 1. Attestation answers, and matches the identity in your governance PR.
curl -s $BASE/api/identity
# {"identity":"03…"}

# 2. The portal is not served.
curl -s -o /dev/null -w '%{http_code}\n' $BASE/
curl -s -o /dev/null -w '%{http_code}\n' $BASE/admin
# 404, 404

# 3. The RPC proxy is not reachable — this is the one that matters most.
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/rpc/cosmos/base/tendermint/v1beta1/node_info
# 404

# 4. Auth, health, and bootstrap are not reachable.
for p in /api/auth/session /api/health /api/bootstrap; do
  curl -s -o /dev/null -w "$p %{http_code}\n" $BASE$p
done
# all 404

# 5. An allowlisted API path is reachable, and rejects an unsigned request
#    with the app's own error rather than the proxy's 404.
curl -s -X POST $BASE/api/status -H 'Content-Type: application/json' -d '{}'
# {"error":"Invalid request. X-Middleman-Identity header was not provided."}
# Before bootstrap has been completed, the same request answers
# {"error":"Forbidden. Application is not ready for requests."} — that is also a pass.

# 6. A GET on a POST-only path is refused by the proxy.
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/status
# 403
```

Step 5 is the important positive check: reaching the app's signature validator proves the path is forwarded, while the request itself is still correctly rejected.

Finally, confirm real traffic works end to end — have a delegator's Middleman run a supplier status sync, or watch your Provider logs for `request signature validated` entries after the next scheduled run.

---

## Related

- [Bootstrap Wizard](./bootstrap.md) — one-time setup, including the App Identity you register with governance
- [Docker Compose deployment](../../../docker-compose/README.md) — dependencies, configuration, and startup
- [Architecture](../../architecture.md) — how Middleman, Provider, and the governance registry fit together
