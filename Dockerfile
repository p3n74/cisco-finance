# Use latest Bun image
FROM oven/bun:latest AS base
WORKDIR /app

# Build stage
FROM base AS builder
ARG VITE_SERVER_URL
ENV VITE_SERVER_URL=$VITE_SERVER_URL
# Copy all files first to ensure workspace resolution works for catalogs and prisma configs
COPY . .

# Install dependencies
RUN bun install

# Generate Prisma Client
RUN bun run db:generate

# Build the applications
RUN bun run build

# Production stage (combined)
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy everything from builder to ensure all symlinks and node_modules are intact
COPY --from=builder /app /app

EXPOSE 3000

# Start the combined server
CMD ["bun", "run", "--cwd", "apps/server", "start"]
