#!/usr/bin/env node

/**
 * Test Script - Create Topup Request
 * 
 * Usage: node test-create-topup.js <driverId> <amount> [method] [note]
 * Example: node test-create-topup.js DRV001 10000 CASH_AGENT "Cash payment at office"
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

// Configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const WALLETS_TABLE = `${ENVIRONMENT}-Wallets`;
const TOPUP_REQUESTS_TABLE = `${ENVIRONMENT}-TopupRequests`;
const AUDIT_TABLE = `${ENVIRONMENT}-AuditLog`;

// Get parameters from command line
const driverId = process.argv[2];
const amount = parseInt(process.argv[3]);
const method = process.argv[4] || 'CASH_AGENT';
const note = process.argv[5] || 'Driver requested topup';

if (!driverId || !amount) {
  console.error('❌ Error: Driver ID and amount are required');
  console.log('Usage: node test-create-topup.js <driverId> <amount> [method] [note]');
  console.log('Example: node test-create-topup.js DRV001 10000 CASH_AGENT "Cash at office"');
  console.log('');
  console.log('Methods: CASH_AGENT, MANUAL_VERIFICATION, BANK_TRANSFER');
  process.exit(1);
}

if (isNaN(amount) || amount <= 0) {
  console.error('❌ Error: Amount must be a positive number');
  process.exit(1);
}

// Initialize DynamoDB client
const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

async function createTopupRequest(driverId, amount, method, note) {
  const walletId = `WALLET#DRIVER#${driverId}`;
  const timestamp = new Date().toISOString();
  const topupId = `TOPUP#${Date.now()}#${uuidv4().split('-')[0]}`;

  console.log('💵 Creating Topup Request');
  console.log('========================');
  console.log(`Driver ID: ${driverId}`);
  console.log(`Amount: ${amount.toLocaleString()} IQD`);
  console.log(`Method: ${method}`);
  console.log(`Note: ${note}`);
  console.log(`Topup ID: ${topupId}`);
  console.log('');

  // Check wallet exists
  console.log('📋 Checking wallet...');
  try {
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: walletId,
          sk: 'META',
        },
      })
    );

    if (!walletResult.Item) {
      console.log('❌ Wallet not found!');
      console.log('Create wallet first:');
      console.log(`node test-create-wallet.js ${driverId}`);
      return;
    }

    const wallet = walletResult.Item;
    console.log(`Current Balance: ${wallet.availableBalance.toLocaleString()} IQD`);
    console.log('');

    // Create topup request
    const topupRequest = {
      topupId,
      sk: 'META',
      driverId,
      walletId,
      amount,
      method,
      status: 'PENDING',
      note,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdById: driverId,
      createdByRole: 'DRIVER',
    };

    console.log('🔨 Creating topup request...');
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: TOPUP_REQUESTS_TABLE,
              Item: topupRequest,
              ConditionExpression: 'attribute_not_exists(topupId)',
            },
          },
          // Audit log
          {
            Put: {
              TableName: AUDIT_TABLE,
              Item: {
                logId: `LOG#${topupId}`,
                datePartition: `date#${timestamp.split('T')[0].replace(/-/g, '')}`,
                sk: timestamp,
                action: 'TOPUP_REQUEST_CREATED',
                walletId,
                amount,
                topupId,
                timestamp,
                metadata: { driverId, method },
              },
            },
          },
        ],
      })
    );

    console.log('✅ Topup request created successfully!');
    console.log('');
    console.log('📊 Request Details:');
    console.log(JSON.stringify(topupRequest, null, 2));
    console.log('');
    console.log('📝 Status: PENDING');
    console.log('⏳ Waiting for admin approval...');
    console.log('');
    console.log('Next steps:');
    console.log('1. Admin reviews the request');
    console.log(`2. Approve: node test-approve-topup.js ${topupId} ADMIN001`);
    console.log(`3. Or reject: node test-reject-topup.js ${topupId} ADMIN001 "Invalid evidence"`);
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      console.error('❌ Transaction failed!');
      console.error('Topup ID may already exist');
    } else {
      console.error('❌ Error creating topup request:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

// Run the test
createTopupRequest(driverId, amount, method, note).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
