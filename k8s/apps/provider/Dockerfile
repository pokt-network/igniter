# DEV ONLY: the local Tilt/kind image (runs `turbo run dev` as root, with the
# full source tree and dev dependencies). Never deploy it or push it to a shared
# registry; production images are built from apps/<app>/Dockerfile. It keeps
# root because Tilt live_update syncs files into it; that was not re-tested.
FROM node:24.22.1-slim AS base

LABEL org.opencontainers.image.description="Igniter local development image (DEV ONLY, runs as root). Do not deploy."
LABEL network.pocket.igniter.dev-only="true"

ENV HOSTNAME="0.0.0.0"
ENV PNPM_HOME="/pnpm"
# pnpm 10+ resolves the global bin to $PNPM_HOME/bin and enforces it must be
# in PATH. Earlier versions accepted $PNPM_HOME itself.
ENV PATH="$PNPM_HOME/bin:$PNPM_HOME:$PATH"

# Install necessary tools and dependencies
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    && npm install -g pnpm@10.15.0 turbo@2.4.4 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only .json and pnpm .yaml files first for efficient caching
COPY out/provider/json .

# Install dependencies for the app
RUN pnpm install

# Copy the remaining application files
COPY out/provider/full .

# Copy the provider drizzle file to run the migration.
COPY provider.drizzle.config.ts .

ENV TURBO_TELEMETRY_DISABLED=1

WORKDIR /app/apps/provider

# Start the development server
CMD ["pnpm", "exec", "turbo", "run", "dev", "--filter=@igniter/provider"]
