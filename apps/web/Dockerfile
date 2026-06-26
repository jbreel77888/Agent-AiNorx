#
# Multi-stage Dockerfile for cloud deployment.
# Builds Next.js inside Docker (no pre-built host artifacts needed).
# Build from repo root: docker build -f apps/web/Dockerfile -t kortix-web .

# ---- Build Stage ----
FROM node:22-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable pnpm

# Increase Node memory for build (Next.js 15 + React 19 needs more memory)
# Trial plan has limited memory; 6144 is a safe middle ground
ENV NODE_OPTIONS="--max-old-space-size=6144"

# Copy workspace root files
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY biome.json tsconfig.base.json .npmrc ./

# Copy the web app and its workspace dependencies
COPY apps/web ./apps/web
COPY packages/shared ./packages/shared
COPY packages/db ./packages/db
COPY packages/llm-gateway ./packages/llm-gateway
COPY packages/agent-tunnel ./packages/agent-tunnel
COPY packages/starter ./packages/starter
COPY packages/manifest-schema ./packages/manifest-schema
COPY packages/registry ./packages/registry

# Install dependencies (skip engine check for compatibility)
RUN pnpm install --filter Kortix-Computer-Frontend... --shamefully-hoist || \
    pnpm install --filter Kortix-Computer-Frontend... --shamefully-hoist --engine-strict=false

# Build-time env vars (placeholders — replaced at runtime by entrypoint)
ENV NEXT_PUBLIC_BILLING_ENABLED=false
ENV NEXT_PUBLIC_BACKEND_URL=http://localhost:8008/v1
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=local-build-placeholder-anon-key
ENV NEXT_OUTPUT=standalone
# Skip Sentry build to save memory on Railway trial plan
ENV SKIP_SENTRY=1
ENV NEXT_PUBLIC_SENTRY_DSN=

# Build the Next.js app with standalone output
# Disable Turbopack for lower memory usage in CI
WORKDIR /app/apps/web
RUN NODE_OPTIONS="--max-old-space-size=6144" pnpm run build

# ---- Runner Stage ----
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

LABEL org.opencontainers.image.title="kortix-frontend" \
      org.opencontainers.image.description="Kortix web frontend (Next.js standalone)" \
      org.opencontainers.image.source="https://github.com/kortix-ai/suna" \
      org.opencontainers.image.licenses="Elastic-2.0" \
      org.opencontainers.image.vendor="Kortix"

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# License
COPY LICENSE /LICENSE

# Copy standalone output from builder
COPY --chown=nextjs:nodejs --from=builder /app/apps/web/.next/standalone ./
COPY --chown=nextjs:nodejs --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=nextjs:nodejs --from=builder /app/apps/web/public ./apps/web/public

# Next standalone output generated from a pnpm worktree can preserve an
# absolute apps/web/node_modules symlink to the host checkout. Recreate
# resolvable package links inside the image from the copied .pnpm store.
RUN rm -rf /app/apps/web/node_modules 2>/dev/null; \
    mkdir -p /app/apps/web/node_modules && \
    if [ -d /app/node_modules/.pnpm ]; then \
      find /app/node_modules/.pnpm -mindepth 3 -maxdepth 3 \( -type d -o -type l \) -path '*/node_modules/*' 2>/dev/null | sort | \
        while read -r target; do \
          pkg=$(basename "$target"); \
          case "$pkg" in @*|.bin|node_modules) continue ;; esac; \
          [ -e "/app/node_modules/$pkg" ] || [ -L "/app/node_modules/$pkg" ] || ln -s "$target" "/app/node_modules/$pkg"; \
          [ -e "/app/apps/web/node_modules/$pkg" ] || [ -L "/app/apps/web/node_modules/$pkg" ] || ln -s "$target" "/app/apps/web/node_modules/$pkg"; \
        done; \
      find /app/node_modules/.pnpm -mindepth 4 -maxdepth 4 \( -type d -o -type l \) -path '*/node_modules/@*/*' 2>/dev/null | sort | \
        while read -r target; do \
          scope=$(basename "$(dirname "$target")"); \
          pkg=$(basename "$target"); \
          mkdir -p "/app/node_modules/$scope" "/app/apps/web/node_modules/$scope"; \
          [ -e "/app/node_modules/$scope/$pkg" ] || [ -L "/app/node_modules/$scope/$pkg" ] || ln -s "$target" "/app/node_modules/$scope/$pkg"; \
          [ -e "/app/apps/web/node_modules/$scope/$pkg" ] || [ -L "/app/apps/web/node_modules/$scope/$pkg" ] || ln -s "$target" "/app/apps/web/node_modules/$scope/$pkg"; \
        done; \
    fi || true

# Remove any .env files from the standalone output
RUN rm -f /app/apps/web/.env /app/apps/web/.env.local /app/apps/web/.env.production /app/.env

# Copy entrypoint script for runtime URL rewriting
COPY apps/web/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)).then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/docker-entrypoint.sh"]
