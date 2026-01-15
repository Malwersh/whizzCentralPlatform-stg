#!/usr/bin/env bash
set -euo pipefail

# Sync WaveSystem_StartWave NOTIFICATIONS_INTERNAL_KEY with the currently deployed
# Notifications service internal key.
#
# Why this exists:
# - The Notifications Serverless stack uses NOTIFICATIONS_INTERNAL_KEY.
# - WaveSystem_StartWave calls /push/send/wave-offer with x-internal-key.
# - If the keys drift, driver push notifications silently stop working for background/terminated apps.

export AWS_PAGER=""
REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"

WAVE_FN="WaveSystem_StartWave"
NOTIF_FN="wizzcentral-notifications-staging-pushSendWaveOffer"

mask() {
  local v="$1"
  if [[ -z "$v" ]]; then
    echo "(empty)"
    return
  fi
  local len=${#v}
  if (( len <= 8 )); then
    printf '%*s' "$len" '' | tr ' ' '*'
    return
  fi
  echo "${v:0:4}…${v: -4} (len=$len)"
}

notif_key=$(aws lambda get-function-configuration \
  --function-name "$NOTIF_FN" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query "Environment.Variables.NOTIFICATIONS_INTERNAL_KEY" \
  --output text)

if [[ -z "$notif_key" || "$notif_key" == "None" ]]; then
  echo "❌ Notifications key is empty on $NOTIF_FN"
  exit 1
fi

wave_env_json=$(aws lambda get-function-configuration \
  --function-name "$WAVE_FN" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query "Environment.Variables" \
  --output json)

current_wave_key=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("NOTIFICATIONS_INTERNAL_KEY", ""))' <<<"$wave_env_json")

echo "Notifications key: $(mask "$notif_key")"
echo "Wave key:          $(mask "$current_wave_key")"

if [[ "$current_wave_key" == "$notif_key" ]]; then
  echo "✅ Keys already match. Nothing to do."
  exit 0
fi

tmp_json="/tmp/update_wave_env.json"
python3 -c 'import json,sys,os
wave=json.loads(os.environ["WAVE_ENV_JSON"])
wave["NOTIFICATIONS_INTERNAL_KEY"]=os.environ["NOTIF_KEY"]
payload={"FunctionName": os.environ["WAVE_FN"], "Environment": {"Variables": wave}}
open(os.environ["OUT"],"w").write(json.dumps(payload))
print("prepared", os.environ["OUT"])' \
  WAVE_ENV_JSON="$wave_env_json" \
  NOTIF_KEY="$notif_key" \
  WAVE_FN="$WAVE_FN" \
  OUT="$tmp_json"

aws lambda update-function-configuration \
  --cli-input-json "file://$tmp_json" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query "LastUpdateStatus" \
  --output text

echo "✅ Updated $WAVE_FN NOTIFICATIONS_INTERNAL_KEY to match Notifications."
