FROM node:24-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.5.2 --activate

# Install all dependencies, including build tools for better-sqlite3 native addon
FROM base AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build the app
FROM deps AS builder
COPY . .
RUN pnpm build

# Production image — Nitro bundles externalized native modules into .output/
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
