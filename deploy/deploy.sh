#!/usr/bin/env bash
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DEPLOY_DIR"

IMAGE_REGISTRY="${IMAGE_REGISTRY:-ghcr.io}"
IMAGE_NAMESPACE="${IMAGE_NAMESPACE:?IMAGE_NAMESPACE is required}"
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
ENV_FILE="${ENV_FILE:-deploy/runtime/compose.env}"
RELEASE_FILE=".release.env"
CANDIDATE_FILE=".release.env.candidate"
COMPOSE_FILE="docker-compose.production.yml"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

required_files=(
  "$COMPOSE_FILE"
  "$ENV_FILE"
  deploy/runtime/postgres.env
  deploy/runtime/migrate.env
  deploy/runtime/stocks-bot.env
  deploy/runtime/publications-bot.env
  deploy/runtime/news-bot.env
  deploy/runtime/mu-clubs-monitor.env
  deploy/runtime/briefing-bot.env
)

required_env_values=(
  "deploy/runtime/postgres.env:POSTGRES_DB"
  "deploy/runtime/postgres.env:POSTGRES_USER"
  "deploy/runtime/postgres.env:POSTGRES_PASSWORD"
  "deploy/runtime/migrate.env:DATABASE_URL"
  "deploy/runtime/stocks-bot.env:DATABASE_URL"
  "deploy/runtime/stocks-bot.env:STOCKS_TELEGRAM_TOKEN"
  "deploy/runtime/stocks-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/stocks-bot.env:OLLAMA_URL"
  "deploy/runtime/stocks-bot.env:OLLAMA_MODEL"
  "deploy/runtime/stocks-bot.env:SEC_USER_AGENT"
  "deploy/runtime/publications-bot.env:DATABASE_URL"
  "deploy/runtime/publications-bot.env:PUBLICATIONS_TELEGRAM_TOKEN"
  "deploy/runtime/publications-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/publications-bot.env:OLLAMA_URL"
  "deploy/runtime/publications-bot.env:OLLAMA_MODEL"
  "deploy/runtime/news-bot.env:DATABASE_URL"
  "deploy/runtime/news-bot.env:NEWS_TELEGRAM_TOKEN"
  "deploy/runtime/news-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/news-bot.env:OLLAMA_URL"
  "deploy/runtime/news-bot.env:OLLAMA_MODEL"
  "deploy/runtime/mu-clubs-monitor.env:DATABASE_URL"
  "deploy/runtime/mu-clubs-monitor.env:MU_CLUBS_API_TOKEN"
  "deploy/runtime/briefing-bot.env:DATABASE_URL"
  "deploy/runtime/briefing-bot.env:BRIEFING_TELEGRAM_TOKEN"
  "deploy/runtime/briefing-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/briefing-bot.env:OLLAMA_URL"
  "deploy/runtime/briefing-bot.env:OLLAMA_MODEL"
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required deployment file: $DEPLOY_DIR/$required_file" >&2
    exit 1
  fi
done

chmod 700 deploy/runtime
while IFS= read -r runtime_file; do
  chmod 600 "$runtime_file"
done < <(find deploy/runtime -maxdepth 1 -type f -print)

missing_env_values=()
for required_env_value in "${required_env_values[@]}"; do
  file="${required_env_value%%:*}"
  key="${required_env_value#*:}"
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"

  if [[ -z "$line" || -z "$value" || "$value" == "''" || "$value" == '""' ]]; then
    missing_env_values+=("$file: $key")
  fi
done

if ((${#missing_env_values[@]} > 0)); then
  echo "Runtime environment files are missing required values:" >&2
  printf '%s\n' "${missing_env_values[@]}" >&2
  exit 1
fi

if ! [[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
fi

insecure_files=()
while IFS= read -r runtime_file; do
  file_mode="$(stat -c '%a' "$runtime_file" 2>/dev/null || stat -f '%Lp' "$runtime_file")"

  if (((8#$file_mode & 8#077) != 0)); then
    insecure_files+=("$runtime_file")
  fi
done < <(find deploy/runtime -maxdepth 1 -type f -print)

if ((${#insecure_files[@]} > 0)); then
  echo "Runtime environment files must not be accessible by group or other users:" >&2
  printf '%s\n' "${insecure_files[@]}" >&2
  exit 1
fi

umask 077

cat >"$CANDIDATE_FILE" <<EOF
IMAGE_REGISTRY=$IMAGE_REGISTRY
IMAGE_NAMESPACE=$IMAGE_NAMESPACE
IMAGE_TAG=$IMAGE_TAG
EOF

compose_candidate() {
  docker compose \
    --env-file "$ENV_FILE" \
    --env-file "$CANDIDATE_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

compose_release() {
  docker compose \
    --env-file "$ENV_FILE" \
    --env-file "$RELEASE_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

cleanup() {
  rm -f "$CANDIDATE_FILE"
}
trap cleanup EXIT

echo "Validating production Compose configuration..."
compose_candidate config --quiet

echo "Pulling release $IMAGE_TAG..."
compose_candidate pull postgres migrate stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot

echo "Starting PostgreSQL..."
compose_candidate up -d postgres

echo "Waiting for PostgreSQL..."
for attempt in {1..30}; do
  if compose_candidate exec -T postgres sh -c \
    'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    break
  fi

  if ((attempt == 30)); then
    echo "PostgreSQL did not become ready." >&2
    exit 1
  fi

  sleep 2
done

mkdir -p backups
backup_path="backups/pre-deploy-$(date -u +%Y%m%dT%H%M%SZ)-${IMAGE_TAG:0:12}.sql.gz"

if compose_candidate exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '\''$POSTGRES_DB'\''" | grep -q '\''^1$'\'''; then
  echo "Creating pre-deploy database backup at $backup_path..."
  compose_candidate exec -T postgres sh -c \
    'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip >"$backup_path"
  find backups -type f -name 'pre-deploy-*.sql.gz' -mtime "+$BACKUP_RETENTION_DAYS" -delete
else
  echo "Skipping the pre-deploy backup because the database does not exist yet."
fi

echo "Applying database migrations..."
compose_candidate run --rm migrate

echo "Starting Watcher bots..."
if ! compose_candidate up \
  -d \
  --remove-orphans \
  --wait \
  --wait-timeout 180 \
  stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot; then
  echo "Release failed its container health checks." >&2

  if [[ -f "$RELEASE_FILE" ]]; then
    echo "Restoring the previous healthy application image..."
    compose_release pull stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot
    compose_release up \
      -d \
      --remove-orphans \
      --wait \
      --wait-timeout 180 \
      stocks-bot publications-bot news-bot mu-clubs-monitor briefing-bot
  fi

  exit 1
fi

mv "$CANDIDATE_FILE" "$RELEASE_FILE"
docker image prune -f --filter 'until=168h' >/dev/null
compose_release ps
echo "Release $IMAGE_TAG is healthy."
