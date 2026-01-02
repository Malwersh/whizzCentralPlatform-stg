#!/usr/bin/env node
console.log('🚀 Starting DynamoDB Clean Population Process');
console.log('This script will replace mixed data with clean structure');

// Test AWS connection
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');

const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

const dynamoDB = DynamoDBDocumentClient.from(ddbClient);
const REGIONS_TABLE = 'WizzCentral_Regions';

async function testConnection() {
    try {
        console.log('🔍 Testing DynamoDB connection...');
        const result = await dynamoDB.send(new ScanCommand({
            TableName: REGIONS_TABLE,
            Limit: 1
        }));
        console.log('✅ DynamoDB connection successful');
        console.log(`📊 Current table has ${result.Count} items (showing 1)`);
        if (result.Items && result.Items.length > 0) {
            console.log('📋 Sample item keys:', Object.keys(result.Items[0]));
        }
    } catch (error) {
        console.error('❌ DynamoDB connection failed:', error.message);
        throw error;
    }
}

testConnection().catch(console.error);
