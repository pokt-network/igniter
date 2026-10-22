FROM node:24.22.1-slim AS base

ARG APP

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
COPY out/provider-workflows/json .

# Install dependencies for the app
RUN pnpm install

# Copy the remaining application files
COPY out/provider-workflows/full .

WORKDIR /app/apps/provider-workflows

# Start the development server
CMD ["pnpm", "exec", "turbo", "run", "dev", "--filter=@igniter/provider-workflows"]
