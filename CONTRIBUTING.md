# Contributing to Igniter

Bug reports, feature requests, and documentation improvements are welcome. Open an issue on [GitHub Issues](https://github.com/pokt-network/igniter/issues) to start a discussion, or jump straight to a pull request for small fixes.

By submitting a pull request, you agree that your contributions will be licensed under the project's existing license terms.

For setting up the development environment, see [DEVELOP.md](DEVELOP.md).

---

## Project Structure

```
igniter/
├── apps/           # Provider (operator UI) and Middleman (delegator UI), plus their Temporal workers
├── packages/       # Shared libraries: UI components, database, Temporal definitions, Pocket SDK, logging
├── docker-compose/ # Deployment compose files (dependencies, provider, middleman)
├── k8s/            # Kubernetes manifests, Tilt config, and deployment overlays
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
