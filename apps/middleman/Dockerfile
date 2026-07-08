FROM node:22-slim AS base

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
COPY out/middleman/json .

# Install dependencies for the app
RUN pnpm install --frozen-lockfile

# Copy the remaining application files
COPY out/middleman/full .

# Copy the middleman drizzle file to run the migration.
COPY middleman.drizzle.config.ts .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm turbo run build --filter=@igniter/middleman

# ------------------------------
# Production runtime (runner)
# ------------------------------
FROM base AS runner

# Install drizzle-kit and related dependencies as production dependencies (as root)
RUN pnpm add --global drizzle-kit@0.30.4 drizzle-orm@0.39.1 pg@^8.14.0 dotenv

WORKDIR /app

# Create non-root user and switch
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 --gid 1001 nextjs

RUN mkdir -p /app/apps/middleman/.next/cache/fetch-cache && \
    chown -R nextjs:nodejs /app/apps/middleman/.next/cache/fetch-cache

# The migration initContainer runs `pnpm run middleman:migration:migrate`
# with workingDir /app as the nextjs user. pnpm writes temp files in the
# CWD, so /app itself must be writable by that user.
RUN chown nextjs:nodejs /app

USER nextjs

# Copy final build output
COPY --from=base --chown=nextjs:nodejs /app/apps/middleman/.next/standalone ./
COPY --from=base --chown=nextjs:nodejs /app/apps/middleman/.next/static ./apps/middleman/.next/static
COPY --from=base --chown=nextjs:nodejs /app/apps/middleman/public ./apps/middleman/public
COPY --from=base --chown=nextjs:nodejs /app/middleman.drizzle.config.ts ./
COPY --from=base --chown=nextjs:nodejs /app/apps/middleman/drizzle/ ./apps/middleman/drizzle/
COPY --from=base --chown=nextjs:nodejs /app/pnpm-workspace.yaml ./pnpm-workspace.yaml

ENV SERVICE_NAME=middleman
# APP_VERSION lives in the FINAL stage so a per-deploy version bump only
# invalidates this layer, not the install/build layers above.
ARG APP_VERSION=unknown
ENV APP_VERSION=${APP_VERSION}

# Start the development server
CMD ["node", "apps/middleman/server.js"]
