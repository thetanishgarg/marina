#!/usr/bin/env bash
# Deploy MARINA's web app to Google Cloud Run, with secrets from Secret Manager
# and Cloud Scheduler replacing the Vercel crons.
#
# Prereqs (once): gcloud auth login && gcloud config set project <PROJECT_ID>
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
#     secretmanager.googleapis.com cloudscheduler.googleapis.com artifactregistry.googleapis.com
#
# Secrets (once, then rotate as needed) — one Secret Manager secret per env var:
#   ./deploy/cloudrun.sh secrets .env.production
#
# Deploy:
#   ./deploy/cloudrun.sh deploy
#   ./deploy/cloudrun.sh crons     # (re)create the Cloud Scheduler jobs
set -euo pipefail

REGION="${REGION:-asia-south1}"          # Mumbai — data stays in India
SERVICE="${SERVICE:-marina-web}"
APP_URL="${APP_URL:-https://marina.team}"
cd "$(dirname "$0")/.."

# Server-side secrets the app reads at runtime.
SECRETS=(DATABASE_URL AUTH_SECRET GEMINI_API_KEY GROQ_API_KEY OPENAI_API_KEY CRON_SECRET
  RESEND_API_KEY GITHUB_ID GITHUB_SECRET GITHUB_APP_ID GITHUB_APP_PRIVATE_KEY
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_SSO_CLIENT_ID GOOGLE_SSO_CLIENT_SECRET
  SLACK_CLIENT_ID SLACK_CLIENT_SECRET SLACK_SIGNING_SECRET
  RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET BLOB_READ_WRITE_TOKEN)

# Plain (non-secret) runtime config.
PLAIN_ENV="AUTH_URL=${APP_URL},NEXT_PUBLIC_APP_URL=${APP_URL},DEFAULT_AI_PROVIDER=gemini,GEMINI_MODEL=gemini-3.5-flash-lite,BLOB_DRIVER=vercel_blob,AUTH_TRUST_HOST=true,MARINA_POLICY_VERSION=v1,LOG_LEVEL=info"

case "${1:-}" in
  secrets)
    ENV_FILE="${2:?usage: cloudrun.sh secrets <env-file>}"
    for KEY in "${SECRETS[@]}"; do
      VAL="$(grep -E "^${KEY}=" "$ENV_FILE" | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//')"
      [ -z "$VAL" ] && { echo "skip $KEY (not in $ENV_FILE)"; continue; }
      if gcloud secrets describe "$KEY" >/dev/null 2>&1; then
        printf '%s' "$VAL" | gcloud secrets versions add "$KEY" --data-file=- >/dev/null
      else
        printf '%s' "$VAL" | gcloud secrets create "$KEY" --replication-policy=automatic --data-file=- >/dev/null
      fi
      echo "secret $KEY ✓"
    done
    ;;

  deploy)
    # 1. Apply pending DB migrations (same step Vercel ran in buildCommand).
    pnpm db:apply:prod
    # 2. Build + deploy from source with Cloud Build (uses ./Dockerfile).
    SECRET_FLAGS=""
    for KEY in "${SECRETS[@]}"; do
      gcloud secrets describe "$KEY" >/dev/null 2>&1 && SECRET_FLAGS+="${KEY}=${KEY}:latest,"
    done
    gcloud run deploy "$SERVICE" \
      --source . \
      --region "$REGION" \
      --allow-unauthenticated \
      --port 8080 \
      --cpu 1 --memory 1Gi \
      --min-instances 0 --max-instances 10 \
      --timeout 300 \
      --set-env-vars "$PLAIN_ENV" \
      --set-secrets "${SECRET_FLAGS%,}"
    gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)'
    ;;

  crons)
    # Same jobs as vercel.json, in IST so schedules read naturally.
    CRON_SECRET_VALUE="$(gcloud secrets versions access latest --secret=CRON_SECRET)"
    while IFS='|' read -r NAME SCHEDULE PATH_; do
      [ -z "$NAME" ] && continue
      gcloud scheduler jobs delete "marina-$NAME" --location "$REGION" --quiet >/dev/null 2>&1 || true
      gcloud scheduler jobs create http "marina-$NAME" \
        --location "$REGION" \
        --schedule "$SCHEDULE" --time-zone "Asia/Kolkata" \
        --uri "${APP_URL}${PATH_}" --http-method GET \
        --headers "Authorization=Bearer ${CRON_SECRET_VALUE}" \
        --attempt-deadline 320s >/dev/null
      echo "cron $NAME ✓ ($SCHEDULE IST)"
    done <<'JOBS'
sweep|30 7 * * *|/api/cron/sweep
calendar|0 9 * * *|/api/cron/calendar
github|30 5 * * *|/api/cron/github
states|0 0 * * *|/api/cron/states
stories|30 0 * * *|/api/cron/stories
digest|0 8 * * 1|/api/cron/digest
digest-daily|0 20 * * *|/api/cron/digest/daily
slack-brief|0 8 * * 1-5|/api/cron/slack-brief
celebrations|30 8 * * *|/api/cron/celebrations
standup-reminder|30 9 * * 1-5|/api/cron/standup-reminder
JOBS
    ;;

  *)
    echo "usage: $0 {secrets <env-file>|deploy|crons}"; exit 1 ;;
esac
