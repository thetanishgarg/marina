# MARINA web app — production image for Google Cloud Run.
#
#   docker build -t marina-web .
#   docker run -p 8080:8080 --env-file .env.production marina-web
#
# Secrets are NEVER baked in: Cloud Run injects them from Secret Manager at
# runtime (see deploy/cloudrun.sh). Only NEXT_PUBLIC_* values are needed at
# build time, passed as --build-arg.

# pnpm is pinned to v10: with no version pinned, corepack resolves the newest
# pnpm (v11), which fails `install` with ERR_PNPM_IGNORED_BUILDS because this
# repo does not list which dependencies may run build scripts. v10 matches the
# lockfile (v9.0) and only warns. The skipped scripts (esbuild, sharp,
# unrs-resolver) ship prebuilt binaries, so nothing is lost.
ARG PNPM_VERSION=10

FROM node:20-bookworm-slim AS deps
ARG PNPM_VERSION
WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION}
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-bookworm-slim AS build
ARG PNPM_VERSION
WORKDIR /app
RUN npm install -g pnpm@${PNPM_VERSION}
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
