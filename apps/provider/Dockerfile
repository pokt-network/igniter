FROM node:24.22.1-slim AS tools

ENV HOSTNAME="0.0.0.0"
ENV PNPM_HOME="/pnpm"
# pnpm 10+ resolves the global bin to $PNPM_HOME/bin and enforces it must be
# in PATH. Earlier versions accepted $PNPM_HOME itself.
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"

# Install necessary tools and dependencies (build stages only; the runtime
# image below gets none of them)
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    && npm install -g pnpm@10.15.0 turbo@2.4.4 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ------------------------------
# Build
# ------------------------------
FROM tools AS base

# Copy only .json and pnpm .yaml files first for efficient caching
COPY out/provider/json .

# Install dependencies for the app
RUN pnpm install --frozen-lockfile

# Copy the remaining application files
COPY out/provider/full .

# Copy the provider drizzle file to run the migration.
COPY provider.drizzle.config.ts .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm turbo run build --filter=@igniter/provider

# ------------------------------
# Migration dependencies
# ------------------------------
# What `pnpm run provider:migration:migrate` needs at runtime: drizzle-kit and
# json-bigint (root package.json) plus drizzle-orm and pg (@igniter/db), at the
# versions pinned in pnpm-lock.yaml. Only those two workspace projects are
# installed, not the whole monorepo.
FROM tools AS migrator

COPY out/provider/json .

RUN pnpm install --frozen-lockfile --filter=igniter --filter=@igniter/db

# ------------------------------
# Production runtime (runner)
# ------------------------------
# A fresh base image: no build tools, no sources, no full node_modules. Only
# the Next.js standalone output, the migration files, and pnpm (the compose
# migration service and the k8s initContainer run `pnpm run ...`).
FROM node:24.22.1-slim AS runner

ENV HOSTNAME="0.0.0.0"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm install -g pnpm@10.15.0 && npm cache clean --force

WORKDIR /app

# Create non-root user and switch
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --gid 1001 nextjs

# The migration initContainer runs `pnpm run provider:migration:migrate`
# with workingDir /app as the nextjs user. pnpm writes temp files in the
# CWD, so /app itself must be writable by that user.
RUN chown nextjs:nodejs /app

USER nextjs

# Migration dependencies first; the standalone output is laid over them. Both
# are pnpm layouts of the same lockfile, so any package present in both is the
# same version.
COPY --from=migrator --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=migrator --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules

# Copy final build output
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/.next/static ./apps/provider/.next/static
#COPY --from=base --chown=nextjs:nodejs /app/apps/provider/public ./apps/provider/public
COPY --from=base --chown=nextjs:nodejs /app/provider.drizzle.config.ts ./
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/drizzle/ ./apps/provider/drizzle/
COPY --from=base --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

RUN mkdir -p /app/apps/provider/.next/cache/fetch-cache

ENV PORT 3001
ENV SERVICE_NAME=provider
# APP_VERSION lives in the FINAL stage so a per-deploy version bump only
# invalidates this layer, not the install/build layers above.
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}

# Start the server
CMD ["node", "apps/provider/server.js"]
