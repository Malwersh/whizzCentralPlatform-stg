#!/bin/bash

# Create WaveOffers DynamoDB Table
# This table tracks all wave offers sent to drivers

set -e

TABLE_NAME="WaveOffers"
REGION="us-east-1"

echo "📋 Creating WaveOffers table..."

aws dynamodb create-table \
  --table-name $TABLE_NAME \
  --attribute-definitions \
    AttributeName=orderId,AttributeType=S \
    AttributeName=SK,AttributeType=S \
    AttributeName=driverId,AttributeType=S \
    AttributeName=sentAt,AttributeType=S \
  --key-schema \
    AttributeName=orderId,KeyType=HASH \
    AttributeName=SK,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --global-secondary-indexes \
    "[
      {
        \"IndexName\": \"DriverOffersIndex\",
        \"KeySchema\": [
          {\"AttributeName\":\"driverId\",\"KeyType\":\"HASH\"},
          {\"AttributeName\":\"sentAt\",\"KeyType\":\"RANGE\"}
        ],
        \"Projection\": {\"ProjectionType\":\"ALL\"}
      }
    ]" \
  --region $REGION \
  --tags Key=Project,Value=WhizzPlatform Key=Component,Value=WaveSystem

echo "⏳ Waiting for table to become active..."
aws dynamodb wait table-exists --table-name $TABLE_NAME --region $REGION

echo "✅ Table $TABLE_NAME created successfully!"
echo ""
echo "📊 Table Details:"
aws dynamodb describe-table --table-name $TABLE_NAME --region $REGION \
  --query 'Table.{Name:TableName,Status:TableStatus,KeySchema:KeySchema,GSI:GlobalSecondaryIndexes[*].IndexName}' \
  --output table

echo ""
echo "🔧 Enable TTL (optional - for automatic cleanup after 7 days):"
echo "aws dynamodb update-time-to-live --table-name $TABLE_NAME --time-to-live-specification Enabled=true,AttributeName=ttl --region $REGION"
