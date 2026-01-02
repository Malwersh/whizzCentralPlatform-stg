#!/bin/bash

# Create Service Accounts in Service Cognito Pool
# Usage: ./create-service-accounts.sh <environment>
# Example: ./create-service-accounts.sh dev

set -e  # Exit on error

ENVIRONMENT=${1:-staging}
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

# Load configuration
CONFIG_FILE="infrastructure/service-cognito-config.env"

if [ ! -f "$CONFIG_FILE" ]; then
  echo -e "${RED}❌ Configuration file not found: ${CONFIG_FILE}${NC}"
  echo "   Run ./infrastructure/deploy-service-cognito.sh first"
  exit 1
fi

source ${CONFIG_FILE}

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}  Creating Service Accounts${NC}"
echo -e "${BLUE}  Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}  User Pool: ${SERVICE_USER_POOL_ID}${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Function to generate strong password
generate_password() {
  # Generate 32-char password with uppercase, lowercase, numbers, and symbols
  LC_ALL=C tr -dc 'A-Za-z0-9!@#$%^&*()_+-=' < /dev/urandom | head -c 32
}

# Function to create service account
create_service_account() {
  local USERNAME=$1
  local SERVICE_NAME=$2
  local SERVICE_ROLE=$3
  local PERMISSIONS=$4
  
  echo -e "${YELLOW}🔧 Creating service account: ${USERNAME}${NC}"
  
  # Generate strong password
  PASSWORD=$(generate_password)
  
  # Check if user already exists
  USER_EXISTS=$(aws cognito-idp admin-get-user \
    --user-pool-id ${SERVICE_USER_POOL_ID} \
    --username ${USERNAME} \
    --region ${REGION} \
    --profile ${PROFILE} 2>&1 || true)
  
  if echo "$USER_EXISTS" | grep -q "UserNotFoundException"; then
    # Create new user
    aws cognito-idp admin-create-user \
      --user-pool-id ${SERVICE_USER_POOL_ID} \
      --username ${USERNAME} \
      --user-attributes \
        Name=custom:service_name,Value=${SERVICE_NAME} \
        Name=custom:service_role,Value=${SERVICE_ROLE} \
      --temporary-password "${PASSWORD}" \
      --message-action SUPPRESS \
      --region ${REGION} \
      --profile ${PROFILE} > /dev/null
    
    echo -e "${GREEN}✅ User created${NC}"
    
    # Set permanent password (skip temp password flow for services)
    aws cognito-idp admin-set-user-password \
      --user-pool-id ${SERVICE_USER_POOL_ID} \
      --username ${USERNAME} \
      --password "${PASSWORD}" \
      --permanent \
      --region ${REGION} \
      --profile ${PROFILE} > /dev/null
    
    echo -e "${GREEN}✅ Password set to permanent${NC}"
    
    # Save credentials to file
    CREDS_FILE="credentials/${ENVIRONMENT}-${USERNAME}.env"
    mkdir -p credentials
    cat > ${CREDS_FILE} << EOF
# Service Account Credentials
# Generated: $(date)
# KEEP THIS FILE SECURE - DO NOT COMMIT TO GIT

ENVIRONMENT=${ENVIRONMENT}
SERVICE_NAME=${SERVICE_NAME}
SERVICE_ROLE=${SERVICE_ROLE}
USERNAME=${USERNAME}
PASSWORD=${PASSWORD}
USER_POOL_ID=${SERVICE_USER_POOL_ID}
CLIENT_ID=${SERVICE_APP_CLIENT_ID}
REGION=${REGION}
PERMISSIONS=${PERMISSIONS}

# Usage in service:
# 1. Store these in AWS Secrets Manager
# 2. Authenticate with Cognito to get JWT token
# 3. Use token in Authorization header
EOF
    
    echo -e "${GREEN}✅ Credentials saved to: ${CREDS_FILE}${NC}"
    echo ""
    
  else
    echo -e "${YELLOW}ℹ️  User already exists: ${USERNAME}${NC}"
    echo -e "${YELLOW}   To reset password, delete user first${NC}"
    echo ""
  fi
}

# Create service accounts
echo -e "${BLUE}📦 Creating service accounts...${NC}"
echo ""

# Order Service Account
create_service_account \
  "order-service-${ENVIRONMENT}" \
  "order-service" \
  "order_manager" \
  "create_wallet,create_hold,capture_hold,release_hold"

# Settlement Service Account
create_service_account \
  "settlement-service-${ENVIRONMENT}" \
  "settlement-service" \
  "settlement_manager" \
  "settle_order,view_settlements,get_settlement"

# Platform Admin Service (for maintenance/migrations)
create_service_account \
  "platform-admin-${ENVIRONMENT}" \
  "platform-service" \
  "platform_admin" \
  "*"

echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}✅ All service accounts created!${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""
echo -e "${YELLOW}⚠️  IMPORTANT SECURITY STEPS:${NC}"
echo ""
echo -e "1. Move credentials to AWS Secrets Manager:"
echo -e "   ${BLUE}aws secretsmanager create-secret \\${NC}"
echo -e "   ${BLUE}  --name ${ENVIRONMENT}/wallet-service/order-service \\${NC}"
echo -e "   ${BLUE}  --secret-string file://credentials/${ENVIRONMENT}-order-service-${ENVIRONMENT}.env${NC}"
echo ""
echo -e "2. Delete local credential files:"
echo -e "   ${BLUE}rm -rf credentials/${NC}"
echo ""
echo -e "3. Update service code to read from Secrets Manager"
echo ""
echo -e "4. Test authentication from each service"
echo ""
echo -e "${GREEN}🎉 Done!${NC}"
