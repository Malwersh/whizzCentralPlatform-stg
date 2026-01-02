#!/bin/bash

# Deploy Cognito User Pool for Wizz Wallet Service

ENVIRONMENT=${1:-dev}
STACK_NAME="${ENVIRONMENT}-wizz-wallet-cognito"
TEMPLATE_FILE="infrastructure/cognito-user-pool.yaml"
REGION="us-east-1"

# Determine AWS profile based on environment
case $ENVIRONMENT in
  dev)
    PROFILE="Wizz_dev_UserApp"
    ;;
  staging)
    PROFILE="Wizz_staging_UserApp"
    ;;
  production)
    PROFILE="Wizz_prod_UserApp"
    ;;
  *)
    echo "❌ Invalid environment: $ENVIRONMENT"
    echo "Usage: ./deploy-cognito.sh [dev|staging|production]"
    exit 1
    ;;
esac

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  🔐 Deploying Cognito User Pool                           ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Environment: $ENVIRONMENT"
echo "Stack Name: $STACK_NAME"
echo "Region: $REGION"
echo "Profile: $PROFILE"
echo ""

# Check if stack exists
STACK_EXISTS=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --profile $PROFILE \
  --region $REGION 2>&1)

if echo "$STACK_EXISTS" | grep -q "does not exist"; then
  echo "📦 Creating new Cognito User Pool stack..."
  COMMAND="create-stack"
else
  echo "🔄 Updating existing Cognito User Pool stack..."
  COMMAND="update-stack"
fi

# Deploy stack
aws cloudformation $COMMAND \
  --stack-name $STACK_NAME \
  --template-body file://$TEMPLATE_FILE \
  --parameters ParameterKey=Environment,ParameterValue=$ENVIRONMENT \
  --capabilities CAPABILITY_NAMED_IAM \
  --profile $PROFILE \
  --region $REGION

if [ $? -eq 0 ]; then
  echo ""
  echo "⏳ Waiting for stack operation to complete..."
  
  if [ "$COMMAND" = "create-stack" ]; then
    aws cloudformation wait stack-create-complete \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION
  else
    aws cloudformation wait stack-update-complete \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION 2>&1 | grep -v "No updates are to be performed"
  fi
  
  if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Cognito User Pool deployed successfully!"
    echo ""
    
    # Get outputs
    echo "📊 Stack Outputs:"
    aws cloudformation describe-stacks \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION \
      --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
      --output table
    
    echo ""
    echo "🔑 Save these values - you'll need them:"
    USER_POOL_ID=$(aws cloudformation describe-stacks \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION \
      --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
      --output text)
    
    DRIVER_CLIENT_ID=$(aws cloudformation describe-stacks \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION \
      --query 'Stacks[0].Outputs[?OutputKey==`DriverAppClientId`].OutputValue' \
      --output text)
    
    ADMIN_CLIENT_ID=$(aws cloudformation describe-stacks \
      --stack-name $STACK_NAME \
      --profile $PROFILE \
      --region $REGION \
      --query 'Stacks[0].Outputs[?OutputKey==`AdminAppClientId`].OutputValue' \
      --output text)
    
    echo ""
    echo "export COGNITO_USER_POOL_ID=$USER_POOL_ID"
    echo "export COGNITO_DRIVER_CLIENT_ID=$DRIVER_CLIENT_ID"
    echo "export COGNITO_ADMIN_CLIENT_ID=$ADMIN_CLIENT_ID"
    echo ""
    
    # Update SAM template with Cognito User Pool ID
    echo "💡 Next step: Update template.yaml with:"
    echo "   CognitoUserPoolId: $USER_POOL_ID"
    echo ""
    
  else
    echo "❌ Stack operation failed"
    exit 1
  fi
else
  echo "❌ Failed to deploy Cognito User Pool"
  exit 1
fi
