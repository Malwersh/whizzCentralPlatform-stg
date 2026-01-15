#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "🚀 Deploying WaveSystem to staging (stack: wavesystem-staging)"

sam build -t template.yaml

PARAMS=(Environment=staging)

if [[ -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  PARAMS+=("GoogleMapsApiKey=$GOOGLE_MAPS_API_KEY")
fi

# Notifications service base + internal key for push fallback
if [[ -n "${NOTIFICATIONS_API_BASE:-}" ]]; then
  PARAMS+=("NotificationsApiBase=$NOTIFICATIONS_API_BASE")
fi

if [[ -n "${NOTIFICATIONS_INTERNAL_KEY:-}" ]]; then
  PARAMS+=("NotificationsInternalKey=$NOTIFICATIONS_INTERNAL_KEY")
else
  echo "⚠️  NOTIFICATIONS_INTERNAL_KEY is empty. WaveSystem will skip push fallback." 
fi

sam deploy \
  --config-file samconfig.toml \
  --config-env staging \
  --no-confirm-changeset \
  --parameter-overrides "${PARAMS[@]}"

echo "✅ WaveSystem deployed. Next: re-deploy Drivers with WaveSystem function names."