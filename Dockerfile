# MARINA web app — production image for Google Cloud Run.
#
#   docker build -t marina-web .
#   docker run -p 8080:8080 --env-file .env.production marina-web
#
# Secrets are NEVER baked in: Cloud Run injects them from Secret Manager at
# runtime (see deploy/cloudrun.sh). Only NEXT_PUBLIC_* values are needed at
# build time, passed as --build-arg.

FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_APP_URL=https://marina.team
ARG NEXT_PUBLIC_DEFAULT_AI_PROVIDER=gemini
ARG NEXT_PUBLIC_MAC_DOWNLOAD_URL
ARG NEXT_PUBLIC_WIN_DOWNLOAD_URL
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_DEFAULT_AI_PROVIDER=$NEXT_PUBLIC_DEFAULT_AI_PROVIDER \
    NEXT_PUBLIC_MAC_DOWNLOAD_URL=$NEXT_PUBLIC_MAC_DOWNLOAD_URL \
    NEXT_PUBLIC_WIN_DOWNLOAD_URL=$NEXT_PUBLIC_WIN_DOWNLOAD_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
RUN pnpm exec next build

FROM node:20-bookworm-slim AS runner
WORKDIR /app
# India-first product: server-local day boundaries (stories, digests, "today")
# should be IST. Cloud Run honours TZ (Vercel does not allow setting it).
ENV NODE_ENV=production \
    TZ=Asia/Kolkata \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
RUN groupadd -r marina && useradd -r -g marina marina
COPY --from=build --chown=marina:marina /app/.next/standalone ./
COPY --from=build --chown=marina:marina /app/.next/static ./.next/static
COPY --from=build --chown=marina:marina /app/public ./public
USER marina
EXPOSE 8080
CMD ["node", "server.js"]
