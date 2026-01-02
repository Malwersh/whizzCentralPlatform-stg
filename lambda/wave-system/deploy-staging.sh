#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "🚀 Deploying WaveSystem to staging (stack: wavesystem-staging)"

sam build -t template.yaml

PARAMS=(Environment=staging)

if [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  PARAMS+=("GoogleMapsApiKey=$GOOGLE_MAPS_API_KEY")
fi

sam deploy \
  --config-file samconfig.toml \
  --config-env staging \
  --parameter-overrides "${PARAMS[@]}"

echo "✅ WaveSystem deployed. Next: re-deploy Drivers with WaveSystem function names."