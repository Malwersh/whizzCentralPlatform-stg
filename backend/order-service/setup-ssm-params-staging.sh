#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
ENVIRONMENT="staging"
COGNITO_STACK_NAME="${ENVIRONMENT}-wizz-service-cognito"

SSM_PREFIX="/whizz/stg/order-service"

CLIENT_ID_PARAM="${SSM_PREFIX}/service-client-id"
CLIENT_SECRET_PARAM="${SSM_PREFIX}/service-client-secret"
USERNAME_PARAM="${SSM_PREFIX}/service-username"
PASSWORD_PARAM="${SSM_PREFIX}/service-password"

USERNAME_VALUE="order-service-${ENVIRONMENT}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WALLET_SERVICE_DIR="$SCRIPT_DIR/../wallet-service"

require_stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$COGNITO_STACK_NAME" \
    --region "$REGION" \
    --profile "$PROFILE" \
    --query "Stacks[0].Outputs[?OutputKey==\`${key}\`].OutputValue" \
    --output text
}

random_password() {
  python3 - <<'PY'
import secrets
import string

alphabet = string.ascii_letters + string.digits + "!@#$%^&*()_+-="
print("".join(secrets.choice(alphabet) for _ in range(32)))
PY
}

echo "== 1) Ensuring service-cognito stack exists: $COGNITO_STACK_NAME"
if ! aws cloudformation describe-stacks --stack-name "$COGNITO_STACK_NAME" --region "$REGION" --profile "$PROFILE" >/dev/null 2>&1; then
  echo "   Stack not found. Deploying it..."
  pushd "$WALLET_SERVICE_DIR/infrastructure" >/dev/null
  ./deploy-service-cognito.sh "$ENVIRONMENT"
  popd >/dev/null
else
  echo "   Stack exists."
fi

echo "== 2) Reading Cognito outputs"
USER_POOL_ID="$(require_stack_output ServiceUserPoolId)"
CLIENT_ID="$(require_stack_output ServiceAppClientId)"

if [[ -z "$USER_POOL_ID" || -z "$CLIENT_ID" || "$USER_POOL_ID" == "None" || "$CLIENT_ID" == "None" ]]; then
  echo "❌ Missing required outputs from $COGNITO_STACK_NAME (ServiceUserPoolId/ServiceAppClientId)"
  exit 1
fi

echo "== 3) Fetching client secret"
CLIENT_SECRET=$(aws cognito-idp describe-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query 'UserPoolClient.ClientSecret' \
  --output text)

if [[ -z "$CLIENT_SECRET" || "$CLIENT_SECRET" == "None" ]]; then
  echo "❌ Could not fetch Cognito client secret (ClientSecret is empty)."
  exit 1
fi

echo "== 4) Ensuring service user exists: $USERNAME_VALUE"
set +e
aws cognito-idp admin-get-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME_VALUE" \
  --region "$REGION" \
  --profile "$PROFILE" >/dev/null 2>&1
USER_EXISTS=$?
set -e

if [[ $USER_EXISTS -ne 0 ]]; then
  echo "   Creating user + setting permanent password"
  PASSWORD_VALUE="$(random_password)"

  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME_VALUE" \
    --user-attributes \
      Name=custom:service_name,Value=order-service \
      Name=custom:service_role,Value=order_manager \
    --temporary-password "$PASSWORD_VALUE" \
    --message-action SUPPRESS \
    --region "$REGION" \
    --profile "$PROFILE" >/dev/null

  aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$USERNAME_VALUE" \
    --password "$PASSWORD_VALUE" \
    --permanent \
    --region "$REGION" \
    --profile "$PROFILE" >/dev/null
else
  echo "   User already exists."
  echo "   NOTE: Not rotating password automatically."
  echo "   If you want rotation, delete the user then rerun this script."

  # Reuse existing password from SSM if present
  set +e
  PASSWORD_VALUE=$(aws ssm get-parameter --name "$PASSWORD_PARAM" --with-decryption --region "$REGION" --profile "$PROFILE" --query Parameter.Value --output text 2>/dev/null)
  set -e
  if [[ -z "${PASSWORD_VALUE:-}" || "${PASSWORD_VALUE:-}" == "None" ]]; then
    echo "❌ User exists but SSM password param not found: $PASSWORD_PARAM"
    echo "   Either delete/recreate the user, or put the password in SSM manually."
    exit 1
  fi
fi

echo "== 5) Writing SSM parameters (idempotent put-parameter)"
aws ssm put-parameter \
  --name "$CLIENT_ID_PARAM" \
  --type String \
  --value "$CLIENT_ID" \
  --overwrite \
  --region "$REGION" \
  --profile "$PROFILE" >/dev/null

aws ssm put-parameter \
  --name "$CLIENT_SECRET_PARAM" \
  --type SecureString \
  --value "$CLIENT_SECRET" \
  --overwrite \
  --region "$REGION" \
  --profile "$PROFILE" >/dev/null

aws ssm put-parameter \
  --name "$USERNAME_PARAM" \
  --type String \
  --value "$USERNAME_VALUE" \
  --overwrite \
  --region "$REGION" \
  --profile "$PROFILE" >/dev/null

aws ssm put-parameter \
  --name "$PASSWORD_PARAM" \
  --type SecureString \
  --value "$PASSWORD_VALUE" \
  --overwrite \
  --region "$REGION" \
  --profile "$PROFILE" >/dev/null

echo "✅ Done. Created/updated:"
echo "- $CLIENT_ID_PARAM"
echo "- $CLIENT_SECRET_PARAM"
echo "- $USERNAME_PARAM"
echo "- $PASSWORD_PARAM"
