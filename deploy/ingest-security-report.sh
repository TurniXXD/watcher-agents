#!/usr/bin/env bash
set -euo pipefail

if (($# != 4)); then
  echo 'Usage: ingest-security-report.sh <project> <service> <scan-key> <report.json>' >&2
  exit 1
fi

project="$1"
service="$2"
scan_key="$3"
report_path="$4"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_env="${MAINTENANCE_RUNTIME_ENV_FILE:-$root_dir/deploy/runtime/maintenance-agent.env}"
endpoint="${MAINTENANCE_SECURITY_INGEST_URL:-http://127.0.0.1:4030/maintenance/security/trivy}"

if [[ ! "$project" =~ ^[A-Za-z0-9._:-]+$ ]] || \
  [[ ! "$service" =~ ^[A-Za-z0-9._:-]+$ ]] || \
  [[ ! "$scan_key" =~ ^[A-Za-z0-9:._@/+\=-]+$ ]]; then
  echo 'Project, service, or scan key contains unsupported characters' >&2
  exit 1
fi
if [[ ! -r "$report_path" ]]; then
  echo "Security report is not readable: $report_path" >&2
  exit 1
fi
if [[ ! -r "$runtime_env" ]]; then
  echo "Maintenance runtime environment is not readable: $runtime_env" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$runtime_env"
set +a
: "${MAINTENANCE_API_TOKEN:?MAINTENANCE_API_TOKEN is required}"
if [[ "$MAINTENANCE_API_TOKEN" == *$'\n'* || "$MAINTENANCE_API_TOKEN" == *$'\r'* ]]; then
  echo 'MAINTENANCE_API_TOKEN must be a single-line value' >&2
  exit 1
fi

curl_token="${MAINTENANCE_API_TOKEN//\\/\\\\}"
curl_token="${curl_token//\"/\\\"}"

scanned_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
{
  printf 'header = "Authorization: Bearer %s"\n' "$curl_token"
  printf 'header = "Content-Type: application/json"\n'
  printf 'header = "X-Watcher-Project: %s"\n' "$project"
  printf 'header = "X-Watcher-Service: %s"\n' "$service"
  printf 'header = "X-Watcher-Scan-Key: %s"\n' "$scan_key"
  printf 'header = "X-Watcher-Scanned-At: %s"\n' "$scanned_at"
} | curl \
  --silent \
  --show-error \
  --fail-with-body \
  --request POST \
  --config - \
  --data-binary "@$report_path" \
  "$endpoint"
