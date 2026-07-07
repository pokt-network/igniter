FROM node:22-slim AS base

ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}
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
RUN pnpm install --frozen-lockfile

# Copy the remaining application files
COPY out/provider/full .

# Copy the provider drizzle file to run the migration.
COPY provider.drizzle.config.ts .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm turbo run build --filter=@igniter/provider

# ------------------------------
# Production runtime (runner)
# ------------------------------
FROM base AS runner

WORKDIR /app

# Install drizzle-kit and related dependencies as production dependencies (as root)
RUN pnpm add --global drizzle-kit@0.30.4 drizzle-orm@0.39.1 pg@^8.14.0 dotenv

# Create non-root user and switch
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --gid 1001 nextjs

RUN mkdir -p /app/apps/provider/.next/cache/fetch-cache && \
    chown -R nextjs:nodejs /app/apps/provider/.next/cache/fetch-cache

# The migration initContainer runs `pnpm run provider:migration:migrate`
# with workingDir /app as the nextjs user. pnpm writes temp files in the
# CWD, so /app itself must be writable by that user.
RUN chown nextjs:nodejs /app

USER nextjs

# Copy final build output
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/.next/static ./apps/provider/.next/static
#COPY --from=base --chown=nextjs:nodejs /app/apps/provider/public ./apps/provider/public
COPY --from=base --chown=nextjs:nodejs /app/provider.drizzle.config.ts ./
COPY --from=base --chown=nextjs:nodejs /app/apps/provider/drizzle/ ./apps/provider/drizzle/
COPY --from=base --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

ENV PORT 3001
ENV SERVICE_NAME=provider

# Start the server
CMD ["node", "apps/provider/server.js"]
