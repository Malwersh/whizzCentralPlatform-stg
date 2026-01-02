#!/bin/bash

# Deploy Service Cognito Pool for Backend Service Accounts
# Usage: ./deploy-service-cognito.sh <environment>
# Example: ./deploy-service-cognito.sh dev

set -e  # Exit on error

ENVIRONMENT=${1:-staging}
STACK_NAME="${ENVIRONMENT}-wizz-service-cognito"
TEMPLATE_FILE="cognito-service-pool.yaml"
REGION="us-east-1"

case "$ENVIRONMENT" in
  dev)
    PROFILE="Wizz_dev_UserApp"
    ;;
  staging)
    PROFILE="Wizz_stg_UserApp"
    ;;
  production)
    PROFILE="Wizz_prod_UserApp"
    ;;
  *)
    PROFILE="Wizz_stg_UserApp"
    ;;
esac

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print header
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Deploying Service Cognito Pool${NC}"
echo -e "${BLUE}  Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}  Stack: ${STACK_NAME}${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
  echo -e "${RED}❌ Invalid environment: ${ENVIRONMENT}${NC}"
  echo "   Valid environments: dev, staging, production"
  exit 1
fi

# Check if template exists
if [ ! -f "$TEMPLATE_FILE" ]; then
  echo -e "${RED}❌ Template file not found: ${TEMPLATE_FILE}${NC}"
  exit 1
fi

# Validate CloudFormation template
echo -e "${YELLOW}🔍 Validating CloudFormation template...${NC}"
aws cloudformation validate-template \
  --template-body file://${TEMPLATE_FILE} \
  --region ${REGION} \
  --profile ${PROFILE} > /dev/null

if [ $? -eq 0 ]; then
  echo -e "${GREEN}✅ Template is valid${NC}"
else
  echo -e "${RED}❌ Template validation failed${NC}"
  exit 1
fi

# Check if stack exists
echo ""
echo -e "${YELLOW}🔍 Checking if stack exists...${NC}"
STACK_EXISTS=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --profile ${PROFILE} 2>&1 || true)

if echo "$STACK_EXISTS" | grep -q "does not exist"; then
  echo -e "${BLUE}📦 Stack does not exist. Creating new stack...${NC}"
  OPERATION="create-stack"
  WAIT_CONDITION="stack-create-complete"
else
  echo -e "${BLUE}🔄 Stack exists. Updating stack...${NC}"
  OPERATION="update-stack"
  WAIT_CONDITION="stack-update-complete"
fi

# Deploy stack
echo ""
echo -e "${YELLOW}🚀 Deploying stack...${NC}"

if [ "$OPERATION" = "create-stack" ]; then
  aws cloudformation create-stack \
    --stack-name ${STACK_NAME} \
    --template-body file://${TEMPLATE_FILE} \
    --parameters ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ${REGION} \
    --profile ${PROFILE} \
    --tags Key=Environment,Value=${ENVIRONMENT} Key=Service,Value=WalletService Key=Purpose,Value=ServiceAuth
  
  echo -e "${YELLOW}⏳ Waiting for stack creation to complete...${NC}"
  aws cloudformation wait ${WAIT_CONDITION} \
    --stack-name ${STACK_NAME} \
    --region ${REGION} \
    --profile ${PROFILE}
else
  # Try to update, but handle "no updates" case
  UPDATE_OUTPUT=$(aws cloudformation update-stack \
    --stack-name ${STACK_NAME} \
    --template-body file://${TEMPLATE_FILE} \
    --parameters ParameterKey=Environment,ParameterValue=${ENVIRONMENT} \
    --capabilities CAPABILITY_NAMED_IAM \
    --region ${REGION} \
    --profile ${PROFILE} 2>&1 || true)
  
  if echo "$UPDATE_OUTPUT" | grep -q "No updates are to be performed"; then
    echo -e "${YELLOW}ℹ️  No updates needed - stack is already up to date${NC}"
  else
    echo -e "${YELLOW}⏳ Waiting for stack update to complete...${NC}"
    aws cloudformation wait ${WAIT_CONDITION} \
      --stack-name ${STACK_NAME} \
      --region ${REGION} \
      --profile ${PROFILE}
  fi
fi

# Get stack outputs
echo ""
echo -e "${GREEN}✅ Stack deployment complete!${NC}"
echo ""
echo -e "${BLUE}📋 Stack Outputs:${NC}"
echo -e "${BLUE}================================================${NC}"

aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --profile ${PROFILE} \
  --query 'Stacks[0].Outputs[*].[OutputKey,OutputValue]' \
  --output table

# Extract and save important values
SERVICE_POOL_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --profile ${PROFILE} \
  --query 'Stacks[0].Outputs[?OutputKey==`ServiceUserPoolId`].OutputValue' \
  --output text)

SERVICE_CLIENT_ID=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --region ${REGION} \
  --profile ${PROFILE} \
  --query 'Stacks[0].Outputs[?OutputKey==`ServiceAppClientId`].OutputValue' \
  --output text)

# Save to config file for later use
CONFIG_FILE="service-cognito-config.env"
cat > ${CONFIG_FILE} << EOF
# Service Cognito Configuration
# Generated: $(date)
# Environment: ${ENVIRONMENT}

ENVIRONMENT=${ENVIRONMENT}
SERVICE_USER_POOL_ID=${SERVICE_POOL_ID}
SERVICE_APP_CLIENT_ID=${SERVICE_CLIENT_ID}
REGION=${REGION}
EOF

echo ""
echo -e "${GREEN}✅ Configuration saved to: ${CONFIG_FILE}${NC}"
echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Next Steps:${NC}"
echo -e "${BLUE}================================================${NC}"
echo -e "1. Update samconfig.toml with:"
echo -e "   ${YELLOW}ServiceCognitoUserPoolId=${SERVICE_POOL_ID}${NC}"
echo ""
echo -e "2. Create service accounts:"
echo -e "   ${YELLOW}./create-service-accounts.sh ${ENVIRONMENT}${NC}"
echo ""
echo -e "3. Deploy wallet service:"
echo -e "   ${YELLOW}./deploy.sh ${ENVIRONMENT}${NC}"
echo ""
echo -e "${GREEN}🎉 Done!${NC}"
