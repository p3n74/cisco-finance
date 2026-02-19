# Use specific Bun version for reproducibility (matches package.json)
FROM oven/bun:1.3.2 AS base
WORKDIR /app

# Build stage
FROM base AS builder

# Build arguments for environment variables
# VITE_SERVER_URL should be set to your Cloud Run URL (without trailing slash)
# If not set, will default to using current origin at runtime
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=${VITE_SERVER_URL:-}

# Copy all files first to ensure workspace resolution works for catalogs and prisma configs
# This is necessary for Bun workspaces to properly resolve dependencies
COPY . .

# Install dependencies
RUN bun install --frozen-lockfile

# Generate Prisma Client
RUN bun run db:generate

# Build the applications
RUN bun run build

# Production stage
FROM base AS runner

# Set production environment
ENV NODE_ENV=production

# Google Cloud Run sets PORT environment variable automatically
# The app will use PORT if set, otherwise defaults to 3000
ENV PORT=3002

WORKDIR /app

# Copy built application and dependencies from builder
COPY --from=builder /app /app

# Expose port (Cloud Run will use PORT env var, but this is for documentation)
EXPOSE 3002

# Health check for Cloud Run (optional but recommended)
# Note: Cloud Run has its own health checks, this is just for Docker
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD bun --version || exit 1

# Start the server
# Cloud Run will automatically set PORT env var, which the app will use
# Run source directly with Bun (Bun handles TypeScript and workspaces natively)
# This ensures proper module resolution for dynamic imports and external deps
CMD ["bun", "run", "--cwd", "apps/server", "src/index.ts"]
