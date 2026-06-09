# syntax=docker/dockerfile:1
# ── Build stage ────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are baked into the client bundle at build time, so the
# API base URL must be set BEFORE `next build`. It is always the same-origin
# proxy path "/api" (nginx routes it to the backend in production).
ARG NEXT_PUBLIC_API_URL=/api
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts

EXPOSE 3001
# `next start -p 3001` (see package.json "start:prod"). Reads BACKEND_ORIGIN at
# runtime for the /api + /socket.io rewrites (used as a fallback; in production
# nginx fronts those paths directly).
CMD ["npm", "run", "start:prod"]
