#!/usr/bin/env node

/**
 * Test Script - Create Driver Wallet
 * 
 * Usage: node test-create-wallet.js <driverId>
 * Example: node test-create-wallet.js DRV001
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const WALLETS_TABLE = `${ENVIRONMENT}-Wallets`;

// Get driver ID from command line
const driverId = process.argv[2];

if (!driverId) {
  console.error('❌ Error: Driver ID is required');
  console.log('Usage: node test-create-wallet.js <driverId>');
  console.log('Example: node test-create-wallet.js DRV001');
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

async function createDriverWallet(driverId) {
  const walletId = `WALLET#DRIVER#${driverId}`;
  const timestamp = new Date().toISOString();

  console.log('🏦 Creating Driver Wallet');
  console.log('========================');
  console.log(`Driver ID: ${driverId}`);
  console.log(`Wallet ID: ${walletId}`);
  console.log(`Table: ${WALLETS_TABLE}`);
  console.log(`Region: ${REGION}`);
  console.log('');

  // Check if wallet already exists
  console.log('📋 Checking if wallet exists...');
  try {
    const getResult = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: walletId,
          sk: 'META',
        },
      })
    );

    if (getResult.Item) {
      console.log('⚠️  Wallet already exists!');
      console.log('');
      console.log('Current wallet state:');
      console.log(JSON.stringify(getResult.Item, null, 2));
      return;
    }
  } catch (error) {
    console.error('❌ Error checking wallet:', error.message);
    process.exit(1);
  }

  // Create new wallet
  console.log('🔨 Creating new wallet...');
  const wallet = {
    walletId: walletId,
    sk: 'META',
    ownerType: 'DRIVER',
    ownerId: driverId,
    currency: 'IQD',
    status: 'ACTIVE',
    availableBalance: 0,
    lockedBalance: 0,
    minRequiredBalance: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 0,
  };

  try {
    await docClient.send(
      new PutCommand({
        TableName: WALLETS_TABLE,
        Item: wallet,
        ConditionExpression: 'attribute_not_exists(walletId)',
      })
    );

    console.log('✅ Wallet created successfully!');
    console.log('');
    console.log('📊 Wallet Details:');
    console.log(JSON.stringify(wallet, null, 2));
    console.log('');
    console.log('🎉 Driver wallet is ready!');
    console.log('');
    console.log('Next steps:');
    console.log('1. Test topup request');
    console.log('2. Test hold creation');
    console.log('3. Test balance query');
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log('⚠️  Wallet already exists (race condition detected)');
    } else {
      console.error('❌ Error creating wallet:', error.message);
      process.exit(1);
    }
  }
}

// Run the test
createDriverWallet(driverId).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
