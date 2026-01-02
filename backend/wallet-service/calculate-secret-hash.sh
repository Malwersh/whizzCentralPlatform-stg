#!/bin/bash

# Calculate Cognito SECRET_HASH
# Usage: ./calculate-secret-hash.sh <username> <client-id> <client-secret>

USERNAME=$1
CLIENT_ID=$2
CLIENT_SECRET=$3

if [ -z "$USERNAME" ] || [ -z "$CLIENT_ID" ] || [ -z "$CLIENT_SECRET" ]; then
  echo "Usage: $0 <username> <client-id> <client-secret>"
  exit 1
fi

# Calculate HMAC-SHA256
MESSAGE="${USERNAME}${CLIENT_ID}"
SECRET_HASH=$(echo -n "$MESSAGE" | openssl dgst -sha256 -hmac "$CLIENT_SECRET" -binary | base64)

echo "$SECRET_HASH"
