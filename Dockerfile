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

# Server target
FROM base AS server
ENV NODE_ENV=production
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
EXPOSE 3000
CMD ["bun", "run", "--cwd", "apps/server", "start"]

# Web target (using Nginx to serve static files)
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
# Add a simple nginx config to handle SPA routing if needed
RUN echo "server { listen 80; location / { root /usr/share/nginx/html; index index.html; try_files \$uri \$uri/ /index.html; } }" > /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
