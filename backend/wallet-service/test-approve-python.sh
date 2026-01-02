#!/bin/bash
# Test approve with Python requests instead of curl

cat > /tmp/test_approve.py << 'EOF'
import requests
import json
import sys

TOPUP_ID = sys.argv[1] if len(sys.argv) > 1 else "TOPUP#1766193165070#b30b313d"
ADMIN_TOKEN = sys.argv[2] if len(sys.argv) > 2 else ""

url = f"https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev/wallet/topup/{TOPUP_ID}/approve"

headers = {
    "Authorization": f"Bearer {ADMIN_TOKEN}",
    "Content-Type": "application/json"
}

data = {"note": "Approved via Python"}

print(f"Approving {TOPUP_ID}...")
response = requests.post(url, headers=headers, json=data)

print(f"Status: {response.status_code}")
print(f"Response: {json.dumps(response.json(), indent=2)}")
EOF

# Get admin token
ADMIN_TOKEN=$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id 5hun8p61grnakisu5gammcjelv \
  --auth-parameters USERNAME=admin@wizz.iq,PASSWORD=Admin@Wizz2025! \
  --profile Wizz_dev_UserApp \
  --region us-east-1 \
  --query 'AuthenticationResult.AccessToken' \
  --output text)

python3 /tmp/test_approve.py "TOPUP#1766193165070#b30b313d" "$ADMIN_TOKEN"
