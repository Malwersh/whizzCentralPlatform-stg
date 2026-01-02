#!/bin/bash

# =====================================
# Add DynamoDB Streams Permissions to Lambda Role
# =====================================

set -e

echo "=========================================="
echo "🔑 Adding DynamoDB Streams Permissions"
echo "=========================================="

ROLE_NAME="lambda-execution-role"
PROFILE="Wizz_dev_UserApp"
AWS_REGION="us-east-1"

echo ""
echo "📝 Creating policy document..."

cat > /tmp/dynamodb-streams-policy.json << 'EOF'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:DescribeStream",
        "dynamodb:ListStreams"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:031857856164:table/WaveOffers/stream/*",
        "arn:aws:dynamodb:us-east-1:031857856164:table/WizzOrders/stream/*"
      ]
    }
  ]
}
EOF

echo "✅ Policy document created"

echo ""
echo "🔗 Attaching policy to role..."

aws iam put-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "DynamoDBStreamsAccess" \
  --policy-document file:///tmp/dynamodb-streams-policy.json \
  --profile "${PROFILE}"

echo "✅ Policy attached successfully"

echo ""
echo "🔍 Verifying policy..."

aws iam get-role-policy \
  --role-name "${ROLE_NAME}" \
  --policy-name "DynamoDBStreamsAccess" \
  --profile "${PROFILE}" \
  --query 'PolicyDocument'

echo ""
echo "=========================================="
echo "✅ Permissions Added Successfully!"
echo "=========================================="
echo ""
echo "The role can now:"
echo "  ✅ Read from DynamoDB Streams"
echo "  ✅ Get stream records"
echo "  ✅ List and describe streams"
echo ""
echo "🔄 Now re-run: ./deploy-update-driver-metrics.sh"
echo "=========================================="

rm /tmp/dynamodb-streams-policy.json
