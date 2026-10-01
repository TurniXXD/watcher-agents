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
NVIDIA_COMPOSE_FILE="docker-compose.nvidia.yml"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

required_files=(
  "$COMPOSE_FILE"
  "$NVIDIA_COMPOSE_FILE"
  "$ENV_FILE"
  deploy/runtime/postgres.env
  deploy/runtime/migrate.env
  deploy/runtime/stocks-bot.env
  deploy/runtime/publications-bot.env
  deploy/runtime/news-bot.env
  deploy/runtime/mu-clubs-monitor.env
  deploy/runtime/brno-events-agent.env
  deploy/runtime/briefing-bot.env
  # The optional Study Bot still has an env file so Compose can parse the full
  # service definition. Its credentials are validated only when it is started.
  deploy/runtime/study-bot.env
  deploy/runtime/maintenance-agent.env
  deploy/runtime/transport-bot.env
  deploy/runtime/sales-bot.env
  deploy/runtime/osint-bot.env
  deploy/runtime/quickly.env
  deploy/runtime/twenty.env
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
  "deploy/runtime/brno-events-agent.env:BRNO_EVENTS_API_TOKEN"
  "deploy/runtime/brno-events-agent.env:DATABASE_URL"
  "deploy/runtime/briefing-bot.env:DATABASE_URL"
  "deploy/runtime/briefing-bot.env:BRIEFING_TELEGRAM_TOKEN"
  "deploy/runtime/briefing-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/briefing-bot.env:BRNO_EVENTS_API_TOKEN"
  "deploy/runtime/briefing-bot.env:MU_CLUBS_API_TOKEN"
  "deploy/runtime/briefing-bot.env:BRIEFING_BRNO_EVENTS_URL"
  "deploy/runtime/briefing-bot.env:BRIEFING_MU_CLUBS_URL"
  "deploy/runtime/briefing-bot.env:OLLAMA_URL"
  "deploy/runtime/briefing-bot.env:OLLAMA_MODEL"
  "deploy/runtime/maintenance-agent.env:DATABASE_URL"
  "deploy/runtime/maintenance-agent.env:MAINTENANCE_API_TOKEN"
  "deploy/runtime/maintenance-agent.env:MAINTENANCE_TELEGRAM_TOKEN"
  "deploy/runtime/maintenance-agent.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/transport-bot.env:DATABASE_URL"
  "deploy/runtime/transport-bot.env:TRANSPORT_TELEGRAM_TOKEN"
  "deploy/runtime/transport-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/transport-bot.env:TRANSPORT_REQUEST_FEED_URL"
  "deploy/runtime/osint-bot.env:DATABASE_URL"
  "deploy/runtime/osint-bot.env:OSINT_TELEGRAM_TOKEN"
  "deploy/runtime/osint-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/sales-bot.env:DATABASE_URL"
  "deploy/runtime/sales-bot.env:SALES_TELEGRAM_TOKEN"
  "deploy/runtime/sales-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/sales-bot.env:SALES_API_TOKEN"
  "deploy/runtime/sales-bot.env:SALES_WEBHOOK_TOKEN"
  "deploy/runtime/quickly.env:POSTGRES_DB"
  "deploy/runtime/quickly.env:POSTGRES_USER"
  "deploy/runtime/quickly.env:POSTGRES_PASSWORD"
  "deploy/runtime/quickly.env:DATABASE_URL"
  "deploy/runtime/quickly.env:QUICKLY_SECRET_KEY"
  "deploy/runtime/twenty.env:POSTGRES_DB"
  "deploy/runtime/twenty.env:POSTGRES_USER"
  "deploy/runtime/twenty.env:POSTGRES_PASSWORD"
  "deploy/runtime/twenty.env:PG_DATABASE_URL"
  "deploy/runtime/twenty.env:ENCRYPTION_KEY"
)

legacy_watcher_services=(
  stocks-bot publications-bot news-bot mu-clubs-monitor brno-events-agent
  briefing-bot maintenance-agent transport-bot
)
watcher_services=("${legacy_watcher_services[@]}" osint-bot sales-bot)
integration_services=(quickly twenty-server twenty-worker)
release_services=("${watcher_services[@]}" "${integration_services[@]}")

study_bot_env_values=(
  "deploy/runtime/study-bot.env:DATABASE_URL"
  "deploy/runtime/study-bot.env:STUDY_TELEGRAM_TOKEN"
  "deploy/runtime/study-bot.env:TELEGRAM_ALLOWED_USER_IDS"
  "deploy/runtime/study-bot.env:OLLAMA_URL"
  "deploy/runtime/study-bot.env:OLLAMA_MODEL"
  "deploy/runtime/study-bot.env:STUDY_S3_ACCESS_KEY_ID"
  "deploy/runtime/study-bot.env:STUDY_S3_SECRET_ACCESS_KEY"
)

required_piper_voice_files=(
  deploy/piper-voices/en_US-amy-medium.onnx
  deploy/piper-voices/en_US-amy-medium.onnx.json
  deploy/piper-voices/en_US-hfc_female-medium.onnx
  deploy/piper-voices/en_US-hfc_female-medium.onnx.json
  deploy/piper-voices/en_US-hfc_male-medium.onnx
  deploy/piper-voices/en_US-hfc_male-medium.onnx.json
  deploy/piper-voices/cs_CZ-jirka-medium.onnx
  deploy/piper-voices/cs_CZ-jirka-medium.onnx.json
)

for required_file in "${required_files[@]}"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Missing required deployment file: $DEPLOY_DIR/$required_file" >&2
    exit 1
  fi
done

release_announcement="deploy/release/next.txt"
if [[ ! -f "$release_announcement" ]] || [[ "$(head -n 1 "$release_announcement")" != "$IMAGE_TAG" ]]; then
  echo "Missing or mismatched release announcement for $IMAGE_TAG." >&2
  exit 1
fi

missing_piper_voice_files=()
for voice_file in "${required_piper_voice_files[@]}"; do
  if [[ ! -r "$voice_file" ]]; then
    missing_piper_voice_files+=("$voice_file")
  fi
done
if ((${#missing_piper_voice_files[@]} > 0)); then
  echo "Required Piper voice files are missing or unreadable:" >&2
  printf '%s\n' "${missing_piper_voice_files[@]}" >&2
  echo "Install them once with PIPER_ACCEPT_VOICE_LICENSES=true ./deploy/download-piper-voices.sh" >&2
  exit 1
fi

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

  if [[ -z "$line" || -z "$value" || "$value" == "''" || "$value" == '""' || "$value" == *'<url-encoded-password>'* || "$value" == *'<same-url-safe-password>'* || "$value" == *'<comma-separated-telegram-user-ids>'* || "$value" == replace-with-* ]]; then
    missing_env_values+=("$file: $key")
  fi
done

if ((${#missing_env_values[@]} > 0)); then
  echo "Runtime environment files are missing required values:" >&2
  printf '%s\n' "${missing_env_values[@]}" >&2
  exit 1
fi

study_bot_missing_values=()
for study_env_value in "${study_bot_env_values[@]}"; do
  file="${study_env_value%%:*}"
  key="${study_env_value#*:}"
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  value="${line#*=}"

  if [[ -z "$line" || -z "$value" || "$value" == "''" || "$value" == '""' ]]; then
    study_bot_missing_values+=("$key")
  fi
done

study_bot_configured=true
if ((${#study_bot_missing_values[@]} > 0)); then
  study_bot_configured=false
  echo "Study Bot is not configured; it will be skipped without blocking this release. Missing: ${study_bot_missing_values[*]}" >&2
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

interpolated_secret_files=()
while IFS= read -r runtime_file; do
  while IFS= read -r runtime_line || [[ -n "$runtime_line" ]]; do
    runtime_value="${runtime_line#*=}"
    runtime_value="${runtime_value#"${runtime_value%%[![:space:]]*}"}"
    runtime_value="${runtime_value%"${runtime_value##*[![:space:]]}"}"

    # Compose treats a fully single-quoted env value literally, including every
    # dollar sign. render-env.sh deliberately uses this form for all values.
    if [[ ${#runtime_value} -ge 2 && "${runtime_value:0:1}" == "'" && "${runtime_value: -1}" == "'" ]]; then
      continue
    fi

    without_escaped_dollars="${runtime_line//\$\$/}"
    if [[ "$without_escaped_dollars" =~ \$\{?[A-Za-z_] ]]; then
      interpolated_secret_files+=("$runtime_file")
      break
    fi
  done <"$runtime_file"
done < <(find deploy/runtime -maxdepth 1 -type f -print)

if ((${#interpolated_secret_files[@]} > 0)); then
  echo "Runtime environment files contain an unescaped Docker Compose variable reference:" >&2
  printf '%s\n' "${interpolated_secret_files[@]}" >&2
  echo "Regenerate them with deploy/render-env.sh, single-quote the complete value, or escape each literal dollar sign as two dollar signs." >&2
  echo "If an affected database password was already used, rotate the database role password and every DATABASE_URL together." >&2
  exit 1
fi

umask 077

cat >"$CANDIDATE_FILE" <<EOF
IMAGE_REGISTRY=$IMAGE_REGISTRY
IMAGE_NAMESPACE=$IMAGE_NAMESPACE
IMAGE_TAG=$IMAGE_TAG
EOF

compose_files=(-f "$COMPOSE_FILE")
if command -v nvidia-smi >/dev/null 2>&1; then
  if docker info --format '{{json .Runtimes}}' | grep -q '"nvidia"'; then
    compose_files+=(-f "$NVIDIA_COMPOSE_FILE")
    echo "NVIDIA runtime detected; exposing GPU utility metrics to maintenance-agent."
  else
    echo "Host NVIDIA GPU detected, but Docker's NVIDIA runtime is unavailable; GPU utilization will be limited to DRM sysfs." >&2
  fi
fi

compose_candidate() {
  docker compose \
    --env-file "$ENV_FILE" \
    --env-file "$CANDIDATE_FILE" \
    "${compose_files[@]}" \
    "$@"
}

compose_release() {
  docker compose \
    --env-file "$ENV_FILE" \
    --env-file "$RELEASE_FILE" \
    "${compose_files[@]}" \
    "$@"
}

verify_briefing_host_gateway() {
  local compose_function="$1"

  "$compose_function" run \
    --rm \
    --no-deps \
    --entrypoint node \
    briefing-bot \
    -e \
    "require('node:dns').lookup('host.docker.internal',(error,address)=>{if(error){console.error(error);process.exit(1)}console.log('host.docker.internal resolves to '+address)})"
}

dump_briefing_container_network() {
  local container_id
  container_id="$(compose_candidate ps -q briefing-bot 2>/dev/null || true)"

  if [[ -z "$container_id" ]]; then
    echo "No briefing-bot container exists to inspect." >&2
    return
  fi

  echo "Briefing bot container network configuration:" >&2
  docker inspect \
    --format 'Image={{.Config.Image}} ExtraHosts={{json .HostConfig.ExtraHosts}}' \
    "$container_id" >&2 || true
  docker exec "$container_id" sh -c \
    'grep -F host.docker.internal /etc/hosts || true' >&2 || true
}

cleanup() {
  rm -f "$CANDIDATE_FILE"
}
trap cleanup EXIT

echo "Validating production Compose configuration..."
compose_candidate config --quiet

mkdir -p backups
backup_stamp="$(date -u +%Y%m%dT%H%M%SZ)-${IMAGE_TAG:0:12}"
backup_created=false
quickly_backup_created=false
twenty_backup_created=false

database_exists() {
  compose_candidate exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '\''$POSTGRES_DB'\''" | grep -q '\''^1$'\'''
}

create_database_backup() {
  local service="$1"
  local backup_path="backups/pre-deploy-${service}-${backup_stamp}.sql.gz"
  echo "Creating pre-deploy database backup at $backup_path..."
  compose_candidate exec -T "$service" sh -c \
    'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip >"$backup_path"
  find backups -type f -name 'pre-deploy-*.sql.gz' -mtime "+$BACKUP_RETENTION_DAYS" -delete
}

echo "Pulling release $IMAGE_TAG..."
compose_candidate pull postgres quickly-postgres twenty-postgres twenty-redis migrate "${release_services[@]}"

if [[ -n "$(compose_candidate ps --status running -q postgres)" ]] && database_exists; then
  echo "Backing up the running database before changing its container image..."
  create_database_backup postgres
  backup_created=true
fi
if [[ -n "$(compose_candidate ps --status running -q quickly-postgres)" ]]; then
  create_database_backup quickly-postgres
  quickly_backup_created=true
fi
if [[ -n "$(compose_candidate ps --status running -q twenty-postgres)" ]]; then
  create_database_backup twenty-postgres
  twenty_backup_created=true
fi

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

if [[ "$backup_created" == false ]]; then
  if database_exists; then
    create_database_backup postgres
  else
    echo "Skipping the pre-deploy backup because the database does not exist yet."
  fi
fi

echo "Starting sales databases and Redis..."
compose_candidate up -d --wait --wait-timeout 180 quickly-postgres twenty-postgres twenty-redis
if [[ "$quickly_backup_created" == false ]]; then
  create_database_backup quickly-postgres
fi
if [[ "$twenty_backup_created" == false ]]; then
  create_database_backup twenty-postgres
fi

echo "Applying database migrations..."
compose_candidate run --rm migrate

echo "Verifying pgvector..."
if ! compose_candidate exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atqc "SELECT extversion FROM pg_extension WHERE extname = '\''vector'\''" | grep -Eq '\''^[0-9]+'\'''; then
  echo "The pgvector extension is not installed after migrations." >&2
  exit 1
fi

echo "Verifying Docker host gateway mapping for Ollama..."
if ! verify_briefing_host_gateway compose_candidate; then
  echo "The briefing-bot container cannot resolve host.docker.internal." >&2
  echo "Upgrade Docker Engine and Docker Compose to versions that support the host-gateway mapping." >&2
  exit 1
fi

echo "Starting required sales integrations..."
if ! compose_candidate up \
  -d \
  --wait \
  --wait-timeout 600 \
  "${integration_services[@]}" || ! compose_candidate up \
  -d \
  --force-recreate \
  --wait \
  --wait-timeout 600 \
  "${watcher_services[@]}"; then
  echo "Release failed its container health checks." >&2
  echo "=== Release service logs before rollback ===" >&2
  compose_candidate logs --tail 100 "${release_services[@]}" >&2 || true
  dump_briefing_container_network

  if [[ -f "$RELEASE_FILE" ]] && ! cmp -s "$CANDIDATE_FILE" "$RELEASE_FILE"; then
    echo "Restoring the previous healthy application image..."
    rollback_services=("${watcher_services[@]}")
    legacy_rollback=false
    if ! compose_release run --rm --no-deps --entrypoint sh osint-bot \
      -c 'test -f apps/osint-bot/dist/health.js'; then
      # The first mandatory rollout may replace an image that predates OSINT
      # readiness. Restore its previously supported services, not a bot that
      # could never pass the new health check with that image.
      echo "Previous image predates OSINT readiness; restoring legacy services only." >&2
      rollback_services=("${legacy_watcher_services[@]}")
      legacy_rollback=true
      compose_candidate stop osint-bot sales-bot quickly twenty-server twenty-worker quickly-postgres twenty-postgres twenty-redis || true
    fi
    compose_release pull "${rollback_services[@]}"
    if [[ "$legacy_rollback" == false ]]; then
      compose_release up \
        -d \
        --wait \
        --wait-timeout 600 \
        "${integration_services[@]}"
    fi
    compose_release up \
      -d \
      --force-recreate \
      --wait \
      --wait-timeout 600 \
      "${rollback_services[@]}"
  elif [[ -f "$RELEASE_FILE" ]]; then
    echo "Previous release matches the failed candidate; skipping an ineffective rollback." >&2
  fi

  exit 1
fi

if [[ "$study_bot_configured" == true ]]; then
  echo "Starting optional Study Bot..."
  if ! compose_candidate pull study-bot || ! compose_candidate up \
    -d \
    --force-recreate \
    --wait \
    --wait-timeout 180 \
    study-bot; then
    echo "Study Bot could not be started; the core Watcher release remains healthy." >&2
    compose_candidate logs --tail 200 study-bot || true
  fi
fi

mv "$CANDIDATE_FILE" "$RELEASE_FILE"
mv "$release_announcement" deploy/release/current.txt
docker image prune -f --filter 'until=168h' >/dev/null
compose_release ps
echo "Release $IMAGE_TAG is healthy."
