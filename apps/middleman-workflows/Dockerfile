FROM node:22-slim AS base

ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
ENV HOSTNAME="0.0.0.0"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

# Install necessary tools and dependencies
RUN apt-get update && apt-get install -y \
    git \
    openssh-client \
    curl \
    && npm install -g pnpm@latest turbo@^2.4.4 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create non-root user and switch
RUN addgroup --system --gid 1001 app && adduser --system --uid 1001 app

RUN chown -R app:app /app

# Copy only .json and pnpm .yaml files first for efficient caching
COPY out/middleman-workflows/json .

# Install dependencies for the app
RUN pnpm install --frozen-lockfile

# Copy the remaining application files
COPY out/middleman-workflows/full .

# Build the application
RUN pnpm turbo run build --filter=@igniter/middleman-workflows

# Switch user
USER app

ENV SERVICE_NAME=middleman-workflows

# Start the server
CMD ["node", "./apps/middleman-workflows/dist/src/worker.js"]
