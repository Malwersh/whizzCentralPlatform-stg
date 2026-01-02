#!/bin/bash

# Deploy DynamoDB Tables for Wallet Service
# This script deploys all wallet-related tables

set -euo pipefail

# Avoid interactive paging in scripted runs
export AWS_PAGER=""

# Configuration
TEMPLATE_FILE="infrastructure/dynamodb-tables.yaml"
ENVIRONMENT="${1:-dev}"           # dev | staging | prod
REGION="${2:-us-east-1}"

case "$ENVIRONMENT" in
  dev)
    PROFILE="${3:-Wizz_dev_UserApp}"
    ;;
  staging)
    PROFILE="${3:-Wizz_stg_UserApp}"
    ;;
  prod)
    PROFILE="${3:-Wizz_prod_UserApp}"
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT (expected dev|staging|prod)"
    exit 1
    ;;
esac

STACK_NAME="${ENVIRONMENT}-wizz-wallet-tables"

echo "🚀 Deploying Wallet Service DynamoDB Tables"
echo "============================================"
echo "Stack Name: $STACK_NAME"
echo "Environment: $ENVIRONMENT"
echo "Region: $REGION"
echo "Profile: $PROFILE"
echo ""

# Validate template
echo "📋 Validating CloudFormation template..."
aws cloudformation validate-template \
  --template-body file://$TEMPLATE_FILE \
  --region $REGION \
  --profile $PROFILE

# Deploy stack
echo ""
echo "🔨 Deploying stack..."
aws cloudformation deploy \
  --template-file $TEMPLATE_FILE \
  --stack-name $STACK_NAME \
  --parameter-overrides Environment=$ENVIRONMENT \
  --region $REGION \
  --profile $PROFILE \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset

# Get outputs
echo ""
echo "✅ Deployment complete!"
echo ""
echo "📊 Table Names:"
aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --profile $PROFILE \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

echo ""
echo "🎉 All tables created successfully!"
echo ""
echo "Next steps:"
echo "1. Run create-platform-wallet.sh to initialize Platform wallet"
echo "2. Deploy Wallet Service Lambda"
echo "3. Configure IAM policies"
