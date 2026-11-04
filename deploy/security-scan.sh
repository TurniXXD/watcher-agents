#!/usr/bin/env bash
set -euo pipefail

WATCHER_ROOT="${WATCHER_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SECURITY_SCAN_OUTPUT_DIR="${SECURITY_SCAN_OUTPUT_DIR:-$WATCHER_ROOT/deploy/security-reports}"
SECURITY_SCAN_STATE_DIR="${SECURITY_SCAN_STATE_DIR:-$WATCHER_ROOT/.security-scan-state}"
TRIVY_CACHE_DIR="${TRIVY_CACHE_DIR:-$WATCHER_ROOT/.trivy-cache}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c}"
SECURITY_SCAN_MIN_INTERVAL_MINUTES="${SECURITY_SCAN_MIN_INTERVAL_MINUTES:-360}"
SECURITY_SCAN_FORCE="${SECURITY_SCAN_FORCE:-false}"
SECURITY_SCAN_IMAGE="${SECURITY_SCAN_IMAGE:-}"

if [[ ! "$SECURITY_SCAN_MIN_INTERVAL_MINUTES" =~ ^[0-9]+$ ]]; then
  echo 'SECURITY_SCAN_MIN_INTERVAL_MINUTES must be a non-negative integer' >&2
  exit 1
fi
if [[ -n "$SECURITY_SCAN_IMAGE" ]] && \
  [[ ! "$SECURITY_SCAN_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
  echo 'SECURITY_SCAN_IMAGE must use an immutable @sha256: digest reference' >&2
  exit 1
fi

install -d -m 700 \
  "$SECURITY_SCAN_OUTPUT_DIR" \
  "$SECURITY_SCAN_STATE_DIR" \
  "$TRIVY_CACHE_DIR"

if [[ "${1:-}" == '--mark-ingested' ]]; then
  if (($# != 3)) || [[ ! "$2" =~ ^(dependencies|image)$ ]] || \
    [[ ! "$3" =~ ^[A-Za-z0-9:._@/+==-]+$ ]]; then
    echo 'Usage: security-scan.sh --mark-ingested <dependencies|image> <scan-key>' >&2
    exit 1
  fi
  printf '%s %s\n' "$3" "$(date +%s)" >"$SECURITY_SCAN_STATE_DIR/$2.state"
  exit 0
fi
if (($# != 0)); then
  echo 'Usage: security-scan.sh [--mark-ingested <dependencies|image> <scan-key>]' >&2
  exit 1
fi

hash_dependencies() {
  local file
  local files=()
  while IFS= read -r file; do
    files+=("$file")
  done < <(
    cd "$WATCHER_ROOT"
    find . \
      -path './.git' -prune -o \
      -path '*/node_modules' -prune -o \
      -type f \( \
        -name 'pnpm-lock.yaml' -o \
        -name 'package-lock.json' -o \
        -name 'npm-shrinkwrap.json' -o \
        -name 'go.mod' -o \
        -name 'go.sum' -o \
        -name 'Cargo.lock' -o \
        -name 'Dockerfile' -o \
        -name 'Dockerfile.*' -o \
        -name 'docker-compose*.yml' -o \
        -name 'docker-compose*.yaml' \
      \) -print | LC_ALL=C sort
  )
  if ((${#files[@]} == 0)); then
    printf 'empty\n' | shasum -a 256 | awk '{print $1}'
    return
  fi
  (
    cd "$WATCHER_ROOT"
    for file in "${files[@]}"; do
      shasum -a 256 "$file"
    done
  ) | shasum -a 256 | awk '{print $1}'
}

should_scan() {
  local target="$1"
  local key="$2"
  local state_file="$SECURITY_SCAN_STATE_DIR/$target.state"
  local previous_key=''
  local previous_epoch='0'
  local now_epoch
  now_epoch="$(date +%s)"
  if [[ -r "$state_file" ]]; then
    read -r previous_key previous_epoch <"$state_file" || true
  fi
  [[ "$SECURITY_SCAN_FORCE" == 'true' ]] || \
    [[ "$key" != "$previous_key" ]] || \
    ((now_epoch - previous_epoch >= SECURITY_SCAN_MIN_INTERVAL_MINUTES * 60))
}

record_report() {
  local target="$1"
  local key="$2"
  printf '%s\n' "$key" >"$SECURITY_SCAN_OUTPUT_DIR/$target.scan-key"
}

docker_mounts=(
  -v "$TRIVY_CACHE_DIR:/cache"
  -v "$SECURITY_SCAN_OUTPUT_DIR:/output"
)
if [[ -n "${SECURITY_SCAN_DOCKER_CONFIG:-}" ]]; then
  docker_mounts+=(
    -e DOCKER_CONFIG=/docker-config
    -v "$SECURITY_SCAN_DOCKER_CONFIG:/docker-config/config.json:ro"
  )
fi

docker_run=(
  docker run --rm
  --security-opt no-new-privileges
  --cap-drop ALL
  --user "$(id -u):$(id -g)"
  "${docker_mounts[@]}"
)

scan_failures=0

dependency_key="$(hash_dependencies)"
if should_scan dependencies "$dependency_key"; then
  if "${docker_run[@]}" \
      -v "$WATCHER_ROOT:/workspace:ro" \
      "$TRIVY_IMAGE" \
      --cache-dir /cache \
      fs \
      --scanners vuln,misconfig \
      --format json \
      --output /output/dependencies.json \
      /workspace; then
    record_report dependencies "$dependency_key"
  else
    echo 'Dependency scan failed; the independent image scan will still run.' >&2
    scan_failures=$((scan_failures + 1))
  fi
else
  echo 'Dependency scan skipped: inputs unchanged and minimum interval not reached.'
fi

if [[ -n "$SECURITY_SCAN_IMAGE" ]]; then
  image_key="${SECURITY_SCAN_IMAGE##*@}"
  if should_scan image "$image_key"; then
    if "${docker_run[@]}" \
        "$TRIVY_IMAGE" \
        --cache-dir /cache \
        image \
        --image-src remote \
        --scanners vuln,misconfig \
        --image-config-scanners misconfig \
        --format json \
        --output /output/image.json \
        "$SECURITY_SCAN_IMAGE"; then
      record_report image "$image_key"
    else
      echo 'Image scan failed independently.' >&2
      scan_failures=$((scan_failures + 1))
    fi
  else
    echo 'Image scan skipped: digest unchanged and minimum interval not reached.'
  fi
fi

if ((scan_failures > 0)); then
  echo "$scan_failures security scan target(s) failed." >&2
  exit 1
fi
