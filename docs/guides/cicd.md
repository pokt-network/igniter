# CI/CD Pipeline

This document describes the complete development, staging, and production release flow for Igniter.

## Overview

```
Feature Branch ──PR──> staging ──PR──> main
                         │                │
                    Deploy Staging    Deploy Production
                    (SHA tags)        (semver tags)
                         │                │
                         ▼                ▼
                   staking-dev.       staking.
                   pocket.network     pocket.network
```

## Branches

| Branch | Purpose | Protected |
|--------|---------|-----------|
| `main` | Production-ready code. Deploys to mainnet. | Yes — requires PR + approval |
| `staging` | Pre-production validation. Deploys to staging. | Yes — requires PR + approval |
| `feat/*`, `fix/*` | Development branches. Target `staging`. | No |

## Environments

| Environment | Namespace | Domain | Image Tag |
|-------------|-----------|--------|-----------|
| Staging | `igniter-staging` | staking-dev.pocket.network | Commit SHA (7 chars) |
| Production | `igniter-mainnet` | staking.pocket.network | Semver (e.g., `0.6.1`) |

## Workflows

### 1. CI (`ci.yml`)

**Trigger:** Every pull request to any branch.

**What it does:**
- Format check (warning — pre-existing issues pending repo-wide fix)
- Lint via `turbo lint` (all packages)
- Build via `turbo build` (all packages)
- Type check via `turbo check-types` (warning — `@igniter/ui` has pre-existing type bugs)
- Test via `turbo test`
- Docker build (no push) for all 4 apps in parallel

**Blocks merge:** Yes — docker builds and tests must pass.

### 2. Deploy Staging (`deploy-staging.yml`)

**Trigger:** PR merged to `staging` with label `release`, or manual `workflow_dispatch`.

**What it does:**
1. Builds and pushes all 4 Docker images to GHCR with commit SHA tag
2. Updates `k8s/apps/middleman/overlays/staging/kustomization.yaml` with the new image tag
3. Commits and pushes the overlay change to `staging`
4. Creates or updates a PR from `staging` → `main`

**What it updates in the repo:**
| File | Change |
|------|--------|
| `k8s/apps/middleman/overlays/staging/kustomization.yaml` | `newTag` → commit SHA |

**What it pushes to GHCR:**
| Image | Tag |
|-------|-----|
| `ghcr.io/pokt-network/middleman` | `<sha>` |
| `ghcr.io/pokt-network/middleman-workflows` | `<sha>` |
| `ghcr.io/pokt-network/provider` | `<sha>` |
| `ghcr.io/pokt-network/provider-workflows` | `<sha>` |

**What ArgoCD deploys (staging):**
- Only `middleman` (no workflows, no provider apps)

### 3. Prepare Release (`prepare-release.yml`)

**Trigger:** Label `release:patch`, `release:minor`, or `release:major` added to a PR targeting `main`.

**What it does:**
1. Reads the latest semver tag (e.g., `v0.6.0`)
2. Computes next version based on label priority: `major` > `minor` > `patch`
3. Updates mainnet overlay kustomization files with the computed version
4. Commits the overlay changes to the PR branch
5. Updates the PR title and body with version details

**What it updates in the repo (on the PR branch):**
| File | Change |
|------|--------|
| `k8s/apps/middleman/overlays/mainnet/kustomization.yaml` | `newTag` → computed semver |
| `k8s/apps/middleman-workflows/overlays/mainnet/kustomization.yaml` | `newTag` → computed semver |

**Why:** The reviewer sees the exact version and overlay changes before approving the merge. No surprises post-merge.

### 4. Deploy Production (`deploy-production.yml`)

**Trigger:** PR merged to `main` with a `release:*` label, or manual `workflow_dispatch`.

**What it does:**
1. Reads version from the mainnet overlay (already set by prepare-release)
2. Builds and pushes all 4 Docker images to GHCR with semver tag + `latest`
3. Creates git tag `v<version>`
4. Creates GitHub Release with auto-generated changelog and Docker images section
5. Rebases `staging` branch on `main` to keep them in sync

**What it pushes to GHCR:**
| Image | Tags |
|-------|------|
| `ghcr.io/pokt-network/middleman` | `<version>`, `latest` |
| `ghcr.io/pokt-network/middleman-workflows` | `<version>`, `latest` |
| `ghcr.io/pokt-network/provider` | `<version>`, `latest` |
| `ghcr.io/pokt-network/provider-workflows` | `<version>`, `latest` |

**What ArgoCD deploys (production):**
- `middleman` + `middleman-workflows`

**What it does NOT update in the repo:**
- Overlays are already updated by `prepare-release.yml` before merge

## Typical Release Flow

```
1. Developer creates feature branch from staging
   git checkout staging && git checkout -b feat/my-feature

2. Developer opens PR → staging
   - CI runs automatically (lint, types, test, docker builds)
   - Team reviews and approves

3. PR merged to staging with label "release"
   - deploy-staging builds + pushes images with SHA tag
   - Staging overlay updated automatically
   - PR staging → main auto-created

4. Team validates on staking-dev.pocket.network

5. Add label "release:patch" (or minor/major) to the staging → main PR
   - prepare-release computes version, updates mainnet overlays
   - PR title updated to "Release v0.6.1"

6. Team reviews version in PR, approves

7. PR merged to main
   - deploy-production builds + pushes images with semver
   - Git tag v0.6.1 created
   - GitHub Release created
   - staging branch rebased on main
```

## Overlay Structure

```
k8s/apps/
├── middleman/
│   ├── base/                          # Shared base (dev + prod)
│   ├── dev/                           # Tilt local dev patches
│   └── overlays/
│       ├── mainnet/                   # Production overlay
│       │   ├── config.json            # ArgoCD app config
│       │   ├── kustomization.yaml     # Image tag managed by CI
│       │   ├── ingress.yaml           # staking.pocket.network
│       │   └── patches/               # ConfigMap, Secrets (1password)
│       └── staging/                   # Staging overlay
│           ├── config.json            # ArgoCD app config
│           ├── kustomization.yaml     # Image tag managed by CI
│           ├── ingress.yaml           # staking-dev.pocket.network
│           └── patches/               # ConfigMap, Secrets (1password)
└── middleman-workflows/
    ├── base/
    ├── dev/
    └── overlays/
        └── mainnet/                   # Production only (no staging)
            ├── config.json
            ├── kustomization.yaml     # Image tag managed by CI
            └── patches/
```

## What CI Manages vs What Requires Manual Changes

### Managed by CI (do not edit manually)

| File | Managed by | When |
|------|-----------|------|
| `overlays/staging/kustomization.yaml` `newTag` | deploy-staging | On merge to staging |
| `overlays/mainnet/kustomization.yaml` `newTag` | prepare-release | On label added to PR |
| Git tags (`v*.*.*`) | deploy-production | On merge to main |
| GitHub Releases | deploy-production | On merge to main |

### Requires Manual Changes

| Item | When |
|------|------|
| Overlay patches (ConfigMap, Secrets, Ingress) | When app config changes |
| Base manifests (deployment, service) | When k8s resource spec changes |
| Adding new apps to overlays | When deploying provider to production |
| ArgoCD ApplicationSet (in k8s repo) | When changing ArgoCD source config |
| Docker images list in workflows | When adding/removing apps |

## Labels

| Label | Purpose | Used on |
|-------|---------|---------|
| `release` | Trigger staging deploy | PRs to `staging` |
| `release:patch` | Bump patch version (0.0.X) | PRs to `main` |
| `release:minor` | Bump minor version (0.X.0) | PRs to `main` |
| `release:major` | Bump major version (X.0.0) | PRs to `main` |

## Manual Triggers

All deploy workflows support `workflow_dispatch` for manual triggers:

- **Deploy Staging:** Actions tab → Deploy Staging → Run workflow (branch: staging)
- **Deploy Production:** Actions tab → Deploy Production → Run workflow (bump_type: patch/minor/major)
- **Build Image:** Actions tab → Build Image → select branch, app, tag, and whether to push

### Build Image (`build-image.yml`)

Ad-hoc image builds from any branch. Useful for:
- Testing a feature branch image before merging
- Building release candidates (e.g., `0.7.0-rc1`)
- Quick dev builds for debugging in a cluster

**Inputs:**
| Input | Description | Example |
|-------|-------------|---------|
| `app` | Which app to build | `middleman` |
| `tag` | Image tag | `dev-fix-auth`, `0.7.0-rc1` |
| `push` | Push to GHCR? | `true` / `false` |

Select the branch in the GitHub Actions UI before running. The image is built from that branch's code.
