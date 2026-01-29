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

# Copy built server and web files
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000

# Start the combined server
CMD ["bun", "run", "--cwd", "apps/server", "start"]
