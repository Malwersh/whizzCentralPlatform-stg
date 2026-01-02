#!/usr/bin/env bash
set -euo pipefail

REGION="us-east-1"
PROFILE="Wizz_stg_UserApp"
STACK_NAME="order-service-staging"

# Fetch parameters from SSM (avoid CloudFormation ssm-secure dynamic refs in Lambda env vars)
WALLET_URL=$(aws ssm get-parameter \
  --name "/whizz/stg/wallet-service/url" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query Parameter.Value \
  --output text)

CLIENT_ID=$(aws ssm get-parameter \
  --name "/whizz/stg/order-service/service-client-id" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query Parameter.Value \
  --output text)

CLIENT_SECRET=$(aws ssm get-parameter \
  --name "/whizz/stg/order-service/service-client-secret" \
  --with-decryption \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query Parameter.Value \
  --output text)

USERNAME=$(aws ssm get-parameter \
  --name "/whizz/stg/order-service/service-username" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query Parameter.Value \
  --output text)

PASSWORD=$(aws ssm get-parameter \
  --name "/whizz/stg/order-service/service-password" \
  --with-decryption \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query Parameter.Value \
  --output text)

npm install
npm run build
sam build

sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --profile "$PROFILE" \
  --resolve-s3 \
  --parameter-overrides \
    Environment=staging \
    WalletServiceUrl="$WALLET_URL" \
    ServiceCognitoClientId="$CLIENT_ID" \
    ServiceCognitoClientSecret="$CLIENT_SECRET" \
    ServiceUsername="$USERNAME" \
    ServicePassword="$PASSWORD"

aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --profile "$PROFILE" \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table
