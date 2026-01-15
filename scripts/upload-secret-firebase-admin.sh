#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./scripts/upload-secret-firebase-admin.sh /absolute/path/to/firebase-admin.json
#
# Stores the Firebase Admin service account JSON in AWS Secrets Manager.
# IMPORTANT: Do NOT commit the JSON file. Keep it outside git.

FILE_PATH="${1:-}"
if [[ -z "$FILE_PATH" || ! -f "$FILE_PATH" ]]; then
  echo "Usage: $0 /absolute/path/to/firebase-admin.json"
  exit 1
fi

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STAGE="staging"
SECRET_ID="wizz/${STAGE}/firebase/admin-service-account"

export AWS_PAGER=""
export AWS_SDK_LOAD_CONFIG=1

echo "🔐 Exporting temporary AWS credentials from SSO profile…"
eval "$(aws configure export-credentials --profile "$PROFILE" --format env)"

echo "🔎 Checking if secret exists: $SECRET_ID"
if aws secretsmanager describe-secret --secret-id "$SECRET_ID" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
  echo "♻️ Updating existing secret: $SECRET_ID"
  aws secretsmanager put-secret-value \
    --secret-id "$SECRET_ID" \
    --secret-string "$(cat "$FILE_PATH")" \
    --region "$REGION" \
    --profile "$PROFILE" >/dev/null
else
  echo "🆕 Creating secret: $SECRET_ID"
  aws secretsmanager create-secret \
    --name "$SECRET_ID" \
    --secret-string "$(cat "$FILE_PATH")" \
    --region "$REGION" \
    --profile "$PROFILE" >/dev/null
fi

echo "✅ Uploaded Firebase Admin JSON to Secrets Manager: $SECRET_ID"