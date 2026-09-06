#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${1:-$ROOT_DIR/deploy/piper-voices}"

if [[ "${PIPER_ACCEPT_VOICE_LICENSES:-false}" != "true" ]]; then
  echo "Review each Piper MODEL_CARD before downloading." >&2
  echo "The HFC voice datasets are CC BY-NC-SA 4.0; Amy refers to its source license; Jirka uses CC0 source data." >&2
  echo "Re-run with PIPER_ACCEPT_VOICE_LICENSES=true if these terms fit your use." >&2
  exit 1
fi

install -d -m 755 "$DATA_DIR"

python3 -m piper.download_voices --data-dir "$DATA_DIR" \
  en_US-amy-medium \
  en_US-hfc_female-medium \
  en_US-hfc_male-medium \
  cs_CZ-jirka-medium

for voice in amy hfc_female hfc_male; do
  curl --fail --location --silent --show-error \
    "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/$voice/medium/MODEL_CARD" \
    --output "$DATA_DIR/$voice-MODEL_CARD"
done

curl --fail --location --silent --show-error \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/cs/cs_CZ/jirka/medium/MODEL_CARD" \
  --output "$DATA_DIR/jirka-MODEL_CARD"

chmod 644 "$DATA_DIR"/*
echo "Downloaded verified Piper models and model cards to $DATA_DIR"
