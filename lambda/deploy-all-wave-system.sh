#!/bin/bash

# ============================================
# Deploy All Wave System Lambda Functions
# ============================================

set -e

AWS_PROFILE="${AWS_PROFILE:-}"
REGION="us-east-1"

PROFILE_ARGS=()
if [ -n "$AWS_PROFILE" ]; then
    PROFILE_ARGS+=(--profile "$AWS_PROFILE")
fi

echo "🚀 Starting Wave System Deployment"
echo "===================================="
echo ""

# Array of all Wave System Lambda functions
LAMBDA_FUNCTIONS=(
    "WaveSystem_CreateDispatchJob"
    "WaveSystem_StartWave"
    "WaveSystem_HandleWaveTimeout"
    "WaveSystem_HandleDriverAccept"
    "WaveSystem_HandleDriverReject"
    "WaveSystem_UpdateDriverMetrics"
)

# Function to deploy a single Lambda
deploy_lambda() {
    local FUNCTION_NAME=$1
    local LAMBDA_DIR="${FUNCTION_NAME}"
    
    echo ""
    echo "📦 Deploying: ${FUNCTION_NAME}"
    echo "----------------------------------------"
    
    if [ ! -d "$LAMBDA_DIR" ]; then
        echo "⚠️  Directory not found: $LAMBDA_DIR - Skipping"
        return
    fi
    
    cd "$LAMBDA_DIR"
    
    # Check if index.js exists
    if [ ! -f "index.js" ]; then
        echo "⚠️  index.js not found - Skipping"
        cd ..
        return
    fi
    
    # Install dependencies if package.json exists
    if [ -f "package.json" ]; then
        echo "📥 Installing dependencies..."
        npm install --production --silent
    fi
    
    # Create deployment package
    echo "📦 Creating deployment package..."
    rm -f function.zip
    
    if [ -d "node_modules" ]; then
        zip -r function.zip index.js node_modules/ package.json -q
    else
        zip function.zip index.js -q
    fi
    
    # Deploy to AWS
    echo "☁️  Uploading to AWS..."
    if aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://function.zip \
        --region "$REGION" \
        "${PROFILE_ARGS[@]}" \
        --output text > /dev/null; then
        echo "✅ ${FUNCTION_NAME} deployed successfully"
    else
        echo "❌ Failed to deploy ${FUNCTION_NAME}"
        cd ..
        return 1
    fi
    
    cd ..
    return 0
}

# Deploy all Lambda functions
DEPLOYED_COUNT=0
FAILED_COUNT=0

for FUNCTION in "${LAMBDA_FUNCTIONS[@]}"; do
    if deploy_lambda "$FUNCTION"; then
        ((DEPLOYED_COUNT++))
    else
        ((FAILED_COUNT++))
    fi
done

echo ""
echo "===================================="
echo "🎉 Deployment Complete!"
echo "===================================="
echo ""
echo "📊 Summary:"
echo "  ✅ Successfully deployed: ${DEPLOYED_COUNT}"
echo "  ❌ Failed: ${FAILED_COUNT}"
echo ""
echo "🔗 Wave System Functions:"
for FUNCTION in "${LAMBDA_FUNCTIONS[@]}"; do
    echo "  • ${FUNCTION}"
done
echo ""
echo "🧪 Next Steps:"
echo "  1. Test by creating a new order"
echo "  2. Monitor CloudWatch logs"
echo "  3. Check WaveOffers table for new offers"
echo "  4. Verify driver app receives notifications"
echo ""
