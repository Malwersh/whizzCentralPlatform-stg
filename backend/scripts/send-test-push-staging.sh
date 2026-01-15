#!/usr/bin/env bash
set -euo pipefail

LOG_PATH="$(pwd)/.tmp/send-test-push-staging.log"
mkdir -p "$(dirname "$LOG_PATH")"
exec > >(tee "$LOG_PATH") 2>&1
echo "Logging to: $LOG_PATH"

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
FRONTEND_STACK="whizz-centralplatform-frontend-staging"
PUSH_API_BASE="https://x066k4dftk.execute-api.us-east-1.amazonaws.com/staging"
DEFAULT_TARGET_SUBJECT_ID="04286448-6061-706c-cf61-b63491c04e13"
TARGET_SUBJECT_ID="${TARGET_SUBJECT_ID:-${1:-$DEFAULT_TARGET_SUBJECT_ID}}"

USER_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name "$FRONTEND_STACK" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='CentralUserPoolId'].OutputValue" \
  --output text)

CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name "$FRONTEND_STACK" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query "Stacks[0].Outputs[?OutputKey=='CentralUserPoolClientId'].OutputValue" \
  --output text)

echo "Central user pool: $USER_POOL_ID"
echo "Central client id: $CLIENT_ID"

# Ensure the support group exists
aws cognito-idp get-group \
  --user-pool-id "$USER_POOL_ID" \
  --group-name support \
  --region "$REGION" \
  --profile "$PROFILE" \
  >/dev/null 2>&1 \
  || aws cognito-idp create-group \
    --user-pool-id "$USER_POOL_ID" \
    --group-name support \
    --description "Support agents" \
    --region "$REGION" \
    --profile "$PROFILE" \
    >/dev/null

USERNAME="support.test.staging@wizz.invalid"
echo "Support username: $USERNAME"
TEMP_PASS=$(python3 - <<'PY'
import secrets
import string

symbols = "!@#$%^&*()-_=+"

upper = secrets.choice(string.ascii_uppercase)
lower = secrets.choice(string.ascii_lowercase)
digit = secrets.choice(string.digits)
symbol = secrets.choice(symbols)

alphabet = string.ascii_letters + string.digits + symbols
rest = [secrets.choice(alphabet) for _ in range(26)]

pw = list(upper + lower + digit + symbol + "".join(rest))
secrets.SystemRandom().shuffle(pw)
print("".join(pw))
PY
)

echo "Temp pass length: ${#TEMP_PASS}"
if [[ "$TEMP_PASS" =~ [^[:alnum:]] ]]; then
  echo "Temp pass has symbol: yes"
else
  echo "Temp pass has symbol: NO (forcing '!')"
  TEMP_PASS="${TEMP_PASS}!"
fi

echo "Stage: ensure support user"

# Create user if missing
set +e
aws cognito-idp admin-get-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --region "$REGION" \
  --profile "$PROFILE" \
  >/dev/null 2>&1
GET_USER_EXIT=$?
set -e

if [[ $GET_USER_EXIT -ne 0 ]]; then
	echo "Support user not found; creating…"
	set +e
	CREATE_OUT=$(aws cognito-idp admin-create-user \
	  --user-pool-id "$USER_POOL_ID" \
	  --username "$USERNAME" \
	  --user-attributes "Name=email,Value=$USERNAME" Name=email_verified,Value=true \
	  --temporary-password "$TEMP_PASS" \
	  --message-action SUPPRESS \
	  --region "$REGION" \
	  --profile "$PROFILE" \
	  2>&1)
	CREATE_EXIT=$?
	set -e

	if [[ $CREATE_EXIT -ne 0 ]]; then
		echo "admin-create-user failed (exit=$CREATE_EXIT): $CREATE_OUT" >&2
		exit $CREATE_EXIT
	fi
else
	echo "Support user exists"
fi

# Set/rotate permanent password (not printed)
echo "Stage: set permanent password"
set +e
PASS_OUT=$(aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --password "$TEMP_PASS" \
  --permanent \
  --region "$REGION" \
  --profile "$PROFILE" \
  2>&1)
PASS_EXIT=$?
set -e

if [[ $PASS_EXIT -ne 0 ]]; then
	echo "admin-set-user-password failed (exit=$PASS_EXIT): $PASS_OUT" >&2
	exit $PASS_EXIT
fi

echo "Permanent password set OK"

# Ensure membership in support group
echo "Stage: add user to support group"
aws cognito-idp admin-add-user-to-group \
  --user-pool-id "$USER_POOL_ID" \
  --username "$USERNAME" \
  --group-name support \
  --region "$REGION" \
  --profile "$PROFILE" \
  >/dev/null

echo "Support group membership OK"

echo "Stage: authenticate"

export USERNAME TEMP_PASS

AUTH_PARAMS_JSON=$(python3 - <<'PY'
import json
import os

print(json.dumps({
    "USERNAME": os.environ["USERNAME"],
    "PASSWORD": os.environ["TEMP_PASS"],
}))
PY
)

set +e
INIT_OUT=$(aws cognito-idp initiate-auth \
  --client-id "$CLIENT_ID" \
  --auth-flow USER_PASSWORD_AUTH \
  --cli-binary-format raw-in-base64-out \
  --auth-parameters "$AUTH_PARAMS_JSON" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --output json 2>&1)
INIT_EXIT=$?
echo "initiate-auth exit: $INIT_EXIT"

AUTH_JSON=""
if [[ $INIT_EXIT -eq 0 ]]; then
	AUTH_JSON="$INIT_OUT"
else
  echo "initiate-auth failed (exit=$INIT_EXIT)" >&2
  echo "initiate-auth output (truncated):" >&2
  printf '%s' "$INIT_OUT" | head -c 400 >&2
  echo >&2
fi

if [[ $INIT_EXIT -ne 0 || -z "${AUTH_JSON}" ]]; then
	AUTH_JSON=$(aws cognito-idp admin-initiate-auth \
	  --user-pool-id "$USER_POOL_ID" \
	  --client-id "$CLIENT_ID" \
	  --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --cli-binary-format raw-in-base64-out \
    --auth-parameters "$AUTH_PARAMS_JSON" \
	  --region "$REGION" \
	  --profile "$PROFILE" \
	  --output json)

  echo "admin-initiate-auth exit: $?"
fi
set -e

echo "Stage: call push endpoint"
echo "AUTH_JSON length: ${#AUTH_JSON}"
ACCESS_TOKEN=$(python3 -c 'import json,sys
data=json.load(sys.stdin)
auth=data.get("AuthenticationResult")
if not isinstance(auth, dict) or "AccessToken" not in auth:
  print("Unexpected auth response (no AccessToken)", file=sys.stderr)
  print(json.dumps({"keys": list(data.keys()), "ChallengeName": data.get("ChallengeName")}, indent=2)[:2000], file=sys.stderr)
  raise SystemExit(2)
print(auth.get("AccessToken") or "")
' <<<"$AUTH_JSON")

echo "Access token length: ${#ACCESS_TOKEN}"

if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Auth JSON (safe dump):"
  python3 -c 'import json,sys
raw=sys.stdin.read()
try:
  data=json.loads(raw)
  summary={"keys": list(data.keys())}
  ar=data.get("AuthenticationResult")
  if isinstance(ar, dict):
    summary["AuthenticationResult_keys"]=list(ar.keys())
    summary["token_lengths"]={k: (len(v) if isinstance(v,str) else None) for k,v in ar.items() if isinstance(k,str)}
  if "ChallengeName" in data:
    summary["ChallengeName"]=data.get("ChallengeName")
  print(json.dumps(summary, indent=2)[:2000])
except Exception as e:
  print("(parse failed)", str(e))
' <<<"$AUTH_JSON"
fi

echo "Access token claims (non-sensitive):"
python3 -c 'import base64,json,sys
token=sys.stdin.read().strip()
parts=token.split(".")
if len(parts)<2:
  print("- not a JWT")
  raise SystemExit(0)
payload_b64=parts[1]+("="*((-len(parts[1]))%4))
payload=json.loads(base64.urlsafe_b64decode(payload_b64).decode("utf-8"))
safe={k: payload.get(k) for k in ["iss","token_use","client_id","username","sub","exp","cognito:groups"] if k in payload}
print(json.dumps(safe, indent=2)[:2000])
' <<<"$ACCESS_TOKEN"

export TARGET_SUBJECT_ID
payload=$(python3 - <<'PY'
import json, time
import os

target=os.environ.get('TARGET_SUBJECT_ID','').strip()
if not target:
  raise SystemExit('Missing TARGET_SUBJECT_ID')
print(json.dumps({
  "target": {"subjectId": target},
  "notification": {"title": "STG Test Push", "body": "Hello Maryam - push is working"},
  "data": {"type": "test", "screen": "home", "ts": int(time.time())}
}))
PY
)

echo "Sending test push to subjectId=$TARGET_SUBJECT_ID …"

RESP=$(curl -sS -X POST "$PUSH_API_BASE/push/send/test" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  --data-raw "$payload" \
  -w "\n__HTTP_STATUS__:%{http_code}\n")

STATUS=$(printf '%s' "$RESP" | python3 -c 'import sys; s=sys.stdin.read(); print(s.split("__HTTP_STATUS__:")[-1].strip())')
BODY=$(printf '%s' "$RESP" | python3 -c 'import sys; s=sys.stdin.read(); print(s.split("\n__HTTP_STATUS__:")[0])')

echo "Push API status: $STATUS"
printf '%s' "$BODY" | python3 -m json.tool
