#!/bin/bash

# Order Service Deployment Script
# Builds and deploys Order Service to AWS

set -e  # Exit on error

echo "🚀 Starting Order Service Deployment..."
echo ""

# Check if we're in the right directory
if [ ! -f "template.yaml" ]; then
    echo "❌ Error: template.yaml not found"
    echo "Please run this script from the order-service directory"
    exit 1
fi

# Step 1: Build TypeScript
echo "📦 Step 1: Building TypeScript..."
npm run build
echo "✅ TypeScript build complete"
echo ""

# Step 2: SAM Build
echo "🔨 Step 2: Running SAM build..."
sam build
echo "✅ SAM build complete"
echo ""

# Step 3: Check if Secrets Manager secret exists
echo "🔑 Step 3: Checking Service Account credentials..."
SECRET_NAME="order-service/dev/credentials"

if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" --region us-east-1 --profile Wizz_dev_UserApp > /dev/null 2>&1; then
    echo "✅ Secret exists: $SECRET_NAME"
else
    echo "⚠️  Secret not found: $SECRET_NAME"
    echo ""
    echo "Creating secret now..."
    echo "Please enter a secure password for order-service account:"
    read -s SERVICE_PASSWORD
    
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --secret-string "{\"password\":\"$SERVICE_PASSWORD\"}" \
        --region us-east-1 \
        --profile Wizz_dev_UserApp
    
    echo "✅ Secret created successfully"
fi
echo ""

# Step 4: SAM Deploy
echo "🚀 Step 4: Deploying to AWS..."
sam deploy \
    --stack-name order-service-dev \
    --region us-east-1 \
    --capabilities CAPABILITY_IAM \
    --no-fail-on-empty-changeset \
    --profile Wizz_dev_UserApp

echo ""
echo "✅ Deployment complete!"
echo ""

# Step 5: Get API endpoint
echo "📋 API Endpoint:"
aws cloudformation describe-stacks \
    --stack-name order-service-dev \
    --region us-east-1 \
    --profile Wizz_dev_UserApp \
    --query 'Stacks[0].Outputs[?OutputKey==`OrderServiceApi`].OutputValue' \
    --output text

echo ""
echo "🎉 Order Service is ready!"
echo ""
echo "Test with:"
echo "curl \$(aws cloudformation describe-stacks --stack-name order-service-dev --region us-east-1 --profile Wizz_dev_UserApp --query 'Stacks[0].Outputs[?OutputKey==\`OrderServiceApi\`].OutputValue' --output text)/health"
