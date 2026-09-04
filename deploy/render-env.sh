#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$ROOT_DIR/deploy/runtime"

required() {
  local name="$1"

  if [[ -z "${!name:-}" ]]; then
    echo "Missing required deployment value: $name" >&2
    exit 1
  fi
}

write_env() {
  local path="$1"
  shift
  : >"$path"

  while (($#)); do
    local key="$1"
    local value="$2"
    local escaped

    if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
      echo "$key must be a single-line value" >&2
      exit 1
    fi

    escaped="${value//\\/\\\\}"
    escaped="${escaped//\'/\\\'}"
    escaped="${escaped//\$/\$\$}"
    printf "%s='%s'\n" "$key" "$escaped" >>"$path"
    shift 2
  done
}

for name in \
  POSTGRES_DB \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  WATCHER_DATABASE_URL \
  STOCKS_TELEGRAM_TOKEN \
  PUBLICATIONS_TELEGRAM_TOKEN \
  TELEGRAM_ALLOWED_USER_IDS \
  OLLAMA_URL \
  OLLAMA_MODEL \
  SEC_USER_AGENT; do
  required "$name"
done

umask 077
rm -rf "$RUNTIME_DIR"
install -d -m 700 "$RUNTIME_DIR"

write_env "$RUNTIME_DIR/compose.env" \
  COMPOSE_PROJECT_NAME "${COMPOSE_PROJECT_NAME:-watcher}"

write_env "$RUNTIME_DIR/postgres.env" \
  POSTGRES_DB "$POSTGRES_DB" \
  POSTGRES_USER "$POSTGRES_USER" \
  POSTGRES_PASSWORD "$POSTGRES_PASSWORD"

write_env "$RUNTIME_DIR/migrate.env" \
  DATABASE_URL "$WATCHER_DATABASE_URL"

write_env "$RUNTIME_DIR/stocks-bot.env" \
  DATABASE_URL "$WATCHER_DATABASE_URL" \
  STOCKS_TELEGRAM_TOKEN "$STOCKS_TELEGRAM_TOKEN" \
  TELEGRAM_ALLOWED_USER_IDS "$TELEGRAM_ALLOWED_USER_IDS" \
  OLLAMA_URL "$OLLAMA_URL" \
  OLLAMA_MODEL "$OLLAMA_MODEL" \
  OLLAMA_KEEP_ALIVE "${OLLAMA_KEEP_ALIVE:-5m}" \
  OLLAMA_MAX_ITEMS_PER_RUN "${OLLAMA_MAX_ITEMS_PER_RUN:-0}" \
  OLLAMA_NUM_CTX "${OLLAMA_NUM_CTX:-4096}" \
  OLLAMA_NUM_PREDICT "${OLLAMA_NUM_PREDICT:-768}" \
  OLLAMA_RETRIES "${OLLAMA_RETRIES:-1}" \
  OLLAMA_THINK "${OLLAMA_THINK:-false}" \
  OLLAMA_TIMEOUT_MS "${OLLAMA_TIMEOUT_MS:-120000}" \
  SEC_USER_AGENT "$SEC_USER_AGENT" \
  DEFAULT_TIMEZONE "${DEFAULT_TIMEZONE:-Europe/Prague}"

write_env "$RUNTIME_DIR/publications-bot.env" \
  DATABASE_URL "$WATCHER_DATABASE_URL" \
  PUBLICATIONS_TELEGRAM_TOKEN "$PUBLICATIONS_TELEGRAM_TOKEN" \
  TELEGRAM_ALLOWED_USER_IDS "$TELEGRAM_ALLOWED_USER_IDS" \
  OLLAMA_URL "$OLLAMA_URL" \
  OLLAMA_MODEL "$OLLAMA_MODEL" \
  OLLAMA_KEEP_ALIVE "${OLLAMA_KEEP_ALIVE:-5m}" \
  OLLAMA_MAX_ITEMS_PER_RUN "${OLLAMA_MAX_ITEMS_PER_RUN:-0}" \
  OLLAMA_NUM_CTX "${OLLAMA_NUM_CTX:-4096}" \
  OLLAMA_NUM_PREDICT "${OLLAMA_NUM_PREDICT:-768}" \
  OLLAMA_RETRIES "${OLLAMA_RETRIES:-1}" \
  OLLAMA_THINK "${OLLAMA_THINK:-false}" \
  OLLAMA_TIMEOUT_MS "${OLLAMA_TIMEOUT_MS:-120000}" \
  DEFAULT_TIMEZONE "${DEFAULT_TIMEZONE:-Europe/Prague}"

chmod 600 "$RUNTIME_DIR"/*.env
echo "Rendered production environment files in $RUNTIME_DIR"
