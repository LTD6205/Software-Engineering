# syntax=docker/dockerfile:1
# ── Build stage ────────────────────────────────────────────────────────────
# Debian-slim (glibc) + build tools so the native `bcrypt` module compiles/links
# reliably. We build the Nest app to dist/ here, then copy the result + the
# already-built node_modules into a clean runtime image.
FROM node:22-slim AS build
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

# Install deps first (better layer caching). --legacy-peer-deps because the
# project has known, expected peer-dependency conflicts (see README).
COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# node_modules is copied from the build stage so the compiled bcrypt binary
# comes along — no native toolchain needed in the runtime image.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./
COPY migrations ./migrations
COPY db-migrate.js seed.js docker-entrypoint.sh ./

EXPOSE 3000
CMD ["sh", "docker-entrypoint.sh"]
