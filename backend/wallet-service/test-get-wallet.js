#!/usr/bin/env node

/**
 * Test Script - Get Wallet Info
 * 
 * Usage: node test-get-wallet.js <driverId>
 * Example: node test-get-wallet.js DRV001
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');

// Configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const WALLETS_TABLE = `${ENVIRONMENT}-Wallets`;

// Get driver ID from command line
const driverId = process.argv[2];

if (!driverId) {
  console.error('❌ Error: Driver ID is required');
  console.log('Usage: node test-get-wallet.js <driverId>');
  console.log('Example: node test-get-wallet.js DRV001');
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

async function getDriverWallet(driverId) {
  const walletId = `WALLET#DRIVER#${driverId}`;

  console.log('🔍 Getting Driver Wallet');
  console.log('=======================');
  console.log(`Driver ID: ${driverId}`);
  console.log(`Wallet ID: ${walletId}`);
  console.log(`Table: ${WALLETS_TABLE}`);
  console.log(`Region: ${REGION}`);
  console.log('');

  try {
    const result = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: walletId,
          sk: 'META',
        },
      })
    );

    if (!result.Item) {
      console.log('❌ Wallet not found!');
      console.log('');
      console.log('Create a wallet first:');
      console.log(`node test-create-wallet.js ${driverId}`);
      return;
    }

    const wallet = result.Item;
    
    console.log('✅ Wallet found!');
    console.log('');
    console.log('📊 Wallet Details:');
    console.log('================');
    console.log(`Owner: ${wallet.ownerType} - ${wallet.ownerId}`);
    console.log(`Status: ${wallet.status}`);
    console.log(`Currency: ${wallet.currency}`);
    console.log('');
    console.log('💰 Balances:');
    console.log(`  Available: ${wallet.availableBalance.toLocaleString()} IQD`);
    console.log(`  Locked: ${wallet.lockedBalance.toLocaleString()} IQD`);
    console.log(`  Total: ${(wallet.availableBalance + wallet.lockedBalance).toLocaleString()} IQD`);
    console.log(`  Min Required: ${wallet.minRequiredBalance.toLocaleString()} IQD`);
    console.log('');
    console.log('📅 Timestamps:');
    console.log(`  Created: ${wallet.createdAt}`);
    console.log(`  Updated: ${wallet.updatedAt}`);
    console.log(`  Version: ${wallet.version}`);
    console.log('');
    console.log('🎉 Wallet query successful!');
  } catch (error) {
    console.error('❌ Error getting wallet:', error.message);
    process.exit(1);
  }
}

// Run the test
getDriverWallet(driverId).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
