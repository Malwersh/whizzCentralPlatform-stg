#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo "🚀 Deploying Wave Push Notification Details Fix (STAGING)"
echo "=================================================="
echo ""

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1) Deploy Notifications service (push-wave-offer handler) via the canonical script.
echo "📦 1/3: Deploying Notifications Service (serverless.notifications.yml)…"
echo "----------------------------------------------------"
cd "$ROOT_DIR"
bash ./deploy-notifications-staging.sh

echo ""
echo "✅ Notifications Service deployed!"
echo ""

# 2) Deploy WaveSystem (includes WaveSystem_StartWave) via SAM script.
echo "📦 2/3: Deploying WaveSystem (WaveSystem_StartWave)…"
echo "----------------------------------------------------"
cd "$ROOT_DIR/../lambda/wave-system"
bash ./deploy-staging.sh

echo ""
echo "✅ WaveSystem deployed!"
echo ""

# 3) Ensure NOTIFICATIONS_INTERNAL_KEY matches between stacks (safety net).
echo "📦 3/3: Syncing NOTIFICATIONS_INTERNAL_KEY (WaveSystem ↔ Notifications)…"
echo "----------------------------------------------------"
cd "$ROOT_DIR"
bash ./scripts/sync-wave-notifications-key-staging.sh

echo ""
echo "=================================================="
echo "✅ All deployments completed successfully!"
echo "=================================================="
echo ""
echo "📋 Expected push payload now includes (examples):"
echo "   • deliveryFee / bonusAmount / orderTotal / estimatedEarnings"
echo "   • customerName / customerAddress / customerLat / customerLng"
echo "   • distance / estimatedMinutes / itemsCount"
echo "   • restaurantId / restaurantName / restaurantImageUrl / restaurantLat / restaurantLng"
echo ""
