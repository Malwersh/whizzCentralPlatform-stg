#!/bin/bash

##############################################################################
# Wizz Wallet Service - Deployment Script
#
# This script builds and deploys the wallet service to AWS Lambda using SAM CLI
#
# Usage:
#   ./deploy.sh [environment]
#
# Environments:
#   dev       - Development environment (default)
#   staging   - Staging environment
#   production - Production environment
#
# Examples:
#   ./deploy.sh              # Deploy to dev
#   ./deploy.sh staging      # Deploy to staging
#   ./deploy.sh production   # Deploy to production
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Parse environment argument
ENVIRONMENT=${1:-dev}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|production)$ ]]; then
    echo -e "${RED}❌ Invalid environment: $ENVIRONMENT${NC}"
    echo "Valid environments: dev, staging, production"
    exit 1
fi

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🚀 Wizz Wallet Service Deployment                         ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Environment:${NC} $ENVIRONMENT"
echo -e "${YELLOW}Region:${NC} us-east-1"
echo ""

# Match local AWS CLI profiles used by samconfig.toml
AWS_PROFILE=""
case "$ENVIRONMENT" in
    dev)
        AWS_PROFILE="Wizz_dev_UserApp"
        ;;
    staging)
        AWS_PROFILE="Wizz_stg_UserApp"
        ;;
    production)
        AWS_PROFILE="Wizz_prod_UserApp"
        ;;
esac

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ SAM CLI is not installed${NC}"
    echo "Install it with: brew install aws-sam-cli"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" &> /dev/null; then
    echo -e "${RED}❌ AWS credentials not configured for profile: $AWS_PROFILE${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Prerequisites check passed"
echo ""

# Step 1: Build TypeScript
echo -e "${BLUE}📦 Step 1/4: Building TypeScript...${NC}"
if npm run build; then
    echo -e "${GREEN}✓${NC} TypeScript build successful"
else
    echo -e "${RED}❌ TypeScript build failed${NC}"
    exit 1
fi
echo ""

# Step 2: Install production dependencies
echo -e "${BLUE}📦 Step 2/4: Installing production dependencies...${NC}"
if npm ci --production; then
    echo -e "${GREEN}✓${NC} Dependencies installed"
else
    echo -e "${RED}❌ Failed to install dependencies${NC}"
    exit 1
fi
echo ""

# Step 3: SAM Build
echo -e "${BLUE}🔨 Step 3/4: Building SAM application...${NC}"
if sam build --config-env "$ENVIRONMENT"; then
    echo -e "${GREEN}✓${NC} SAM build successful"
else
    echo -e "${RED}❌ SAM build failed${NC}"
    exit 1
fi
echo ""

# Step 4: SAM Deploy
echo -e "${BLUE}🚀 Step 4/4: Deploying to AWS...${NC}"
if sam deploy --config-env "$ENVIRONMENT" --no-confirm-changeset; then
    echo ""
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  ✅ Deployment Successful!                                 ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    
    # Get API Gateway endpoint
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name "${ENVIRONMENT}-wizz-wallet-service" \
        --query "Stacks[0].Outputs[?OutputKey=='WalletServiceApi'].OutputValue" \
        --output text \
        --profile "$AWS_PROFILE" \
        --region us-east-1 2>/dev/null || echo "Unable to retrieve")
    
    echo -e "${YELLOW}📡 API Endpoint:${NC}"
    echo "   $API_URL"
    echo ""
    
    echo -e "${YELLOW}🧪 Test the API:${NC}"
    echo "   curl $API_URL/health"
    echo ""
    
    echo -e "${YELLOW}📊 View Logs:${NC}"
    echo "   sam logs --stack-name ${ENVIRONMENT}-wizz-wallet-service --tail --config-env $ENVIRONMENT"
    echo ""
    
    echo -e "${YELLOW}🔍 CloudWatch Logs:${NC}"
    echo "   https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252F${ENVIRONMENT}-wizz-wallet-service"
    echo ""
    
else
    echo -e "${RED}❌ Deployment failed${NC}"
    exit 1
fi

# Step 5 (staging/dev): Attach Cognito PostConfirmation trigger
if [[ "$ENVIRONMENT" == "dev" || "$ENVIRONMENT" == "staging" ]]; then
    echo ""
    echo -e "${BLUE}🔗 Step 5/5: Attaching Cognito PostConfirmation trigger...${NC}"
    if bash ./attach-wallet-postconfirmation-trigger.sh "$ENVIRONMENT"; then
        echo -e "${GREEN}✓${NC} Cognito trigger attached"
    else
        echo -e "${RED}❌ Failed to attach Cognito trigger${NC}"
        exit 1
    fi
fi

# Reinstall dev dependencies
echo -e "${BLUE}📦 Reinstalling dev dependencies...${NC}"
npm install &> /dev/null
echo -e "${GREEN}✓${NC} Done"
echo ""

echo -e "${GREEN}🎉 All done! Wallet service is live on AWS Lambda${NC}"
