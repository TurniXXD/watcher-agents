#!/usr/bin/env bash
set -euo pipefail

env_file="${1:?usage: normalize-database-url-host.sh ENV_FILE SOURCE_HOST TARGET_HOST}"
source_host="${2:?usage: normalize-database-url-host.sh ENV_FILE SOURCE_HOST TARGET_HOST}"
target_host="${3:?usage: normalize-database-url-host.sh ENV_FILE SOURCE_HOST TARGET_HOST}"

if [[ ! -f "$env_file" ]]; then
  echo "Runtime environment file does not exist: $env_file" >&2
  exit 1
fi

umask 077
temporary_file="$(mktemp "${env_file}.tmp.XXXXXX")"
cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

database_url_count=0
changed=false
source_marker="@${source_host}:"
target_marker="@${target_host}:"

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == DATABASE_URL=* ]]; then
    database_url_count=$((database_url_count + 1))
    normalized_line="${line/"$source_marker"/"$target_marker"}"
    if [[ "$normalized_line" != "$line" ]]; then
      line="$normalized_line"
      changed=true
    fi
  fi
  printf '%s\n' "$line" >>"$temporary_file"
done <"$env_file"

if ((database_url_count != 1)); then
  echo "$env_file must contain exactly one DATABASE_URL entry" >&2
  exit 1
fi

if [[ "$changed" == true ]]; then
  chmod 600 "$temporary_file"
  mv "$temporary_file" "$env_file"
  echo "Updated the DATABASE_URL database host in $env_file."
fi
