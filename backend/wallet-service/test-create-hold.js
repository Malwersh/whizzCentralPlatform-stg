#!/usr/bin/env node

/**
 * Test Script - Create Hold
 * 
 * Usage: node test-create-hold.js <driverId> <amount> <orderId>
 * Example: node test-create-hold.js DRV001 5000 ORD123
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

// Configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const WALLETS_TABLE = `${ENVIRONMENT}-Wallets`;
const HOLDS_TABLE = `${ENVIRONMENT}-Holds`;
const LEDGER_TABLE = `${ENVIRONMENT}-LedgerEntries`;
const AUDIT_TABLE = `${ENVIRONMENT}-AuditLog`;

// Get parameters from command line
const driverId = process.argv[2];
const amount = parseInt(process.argv[3]);
const orderId = process.argv[4];

if (!driverId || !amount || !orderId) {
  console.error('❌ Error: Missing required parameters');
  console.log('Usage: node test-create-hold.js <driverId> <amount> <orderId>');
  console.log('Example: node test-create-hold.js DRV001 5000 ORD123');
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

async function createHold(driverId, amount, orderId) {
  const walletId = `WALLET#DRIVER#${driverId}`;
  const timestamp = new Date().toISOString();
  const holdId = `HOLD#${Date.now()}#${uuidv4().split('-')[0]}`;
  const txnId = `txn_${Date.now()}_${uuidv4().split('-')[0]}`;

  console.log('🔒 Creating Hold');
  console.log('===============');
  console.log(`Driver ID: ${driverId}`);
  console.log(`Wallet ID: ${walletId}`);
  console.log(`Amount: ${amount.toLocaleString()} IQD`);
  console.log(`Order ID: ${orderId}`);
  console.log(`Hold ID: ${holdId}`);
  console.log('');

  // Get current wallet state
  console.log('📋 Checking wallet balance...');
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

    if (!getResult.Item) {
      console.log('❌ Wallet not found!');
      console.log('Create wallet first:');
      console.log(`node test-create-wallet.js ${driverId}`);
      return;
    }

    const wallet = getResult.Item;
    console.log(`Current Available Balance: ${wallet.availableBalance.toLocaleString()} IQD`);
    console.log(`Current Locked Balance: ${wallet.lockedBalance.toLocaleString()} IQD`);
    console.log('');

    if (wallet.availableBalance < amount) {
      console.log('❌ Insufficient balance!');
      console.log(`Available: ${wallet.availableBalance.toLocaleString()} IQD`);
      console.log(`Required: ${amount.toLocaleString()} IQD`);
      console.log(`Shortage: ${(amount - wallet.availableBalance).toLocaleString()} IQD`);
      return;
    }

    // Prepare hold record
    const hold = {
      holdId,
      sk: 'META',
      walletId,
      driverId,
      orderId,
      amount,
      status: 'ACTIVE',
      reason: 'Order delivery fee hold',
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // Prepare ledger entries
    const debitEntry = {
      walletId,
      sk: `ts#${timestamp}#0`,
      txnId,
      type: 'HOLD_CREATED',
      amount: -amount,
      balance: wallet.availableBalance - amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold created for order ${orderId}`,
      metadata: { orderId, holdId },
      timestamp,
    };

    const creditEntry = {
      walletId,
      sk: `ts#${timestamp}#1`,
      txnId,
      type: 'HOLD_CREATED',
      amount: amount,
      balance: wallet.lockedBalance + amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold created for order ${orderId}`,
      metadata: { orderId, holdId, balanceType: 'LOCKED' },
      timestamp,
    };

    // Create hold atomically
    console.log('🔨 Creating hold...');
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Create hold
          {
            Put: {
              TableName: HOLDS_TABLE,
              Item: hold,
              ConditionExpression: 'attribute_not_exists(orderId)',
            },
          },
          // Update wallet balances
          {
            Update: {
              TableName: WALLETS_TABLE,
              Key: { walletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance - :amount, ' +
                'lockedBalance = lockedBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ConditionExpression:
                'availableBalance >= :amount AND #version = :currentVersion',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': amount,
                ':timestamp': timestamp,
                ':one': 1,
                ':currentVersion': wallet.version,
              },
            },
          },
          // Record debit entry
          {
            Put: {
              TableName: LEDGER_TABLE,
              Item: debitEntry,
            },
          },
          // Record credit entry
          {
            Put: {
              TableName: LEDGER_TABLE,
              Item: creditEntry,
            },
          },
          // Audit log
          {
            Put: {
              TableName: AUDIT_TABLE,
              Item: {
                logId: `LOG#${txnId}`,
                datePartition: `date#${timestamp.split('T')[0].replace(/-/g, '')}`,
                sk: timestamp,
                action: 'HOLD_CREATED',
                walletId,
                amount,
                holdId,
                orderId,
                timestamp,
                metadata: { driverId },
              },
            },
          },
        ],
      })
    );

    console.log('✅ Hold created successfully!');
    console.log('');
    console.log('📊 Hold Details:');
    console.log(JSON.stringify(hold, null, 2));
    console.log('');
    console.log('💰 New Balances:');
    console.log(`Available: ${(wallet.availableBalance - amount).toLocaleString()} IQD`);
    console.log(`Locked: ${(wallet.lockedBalance + amount).toLocaleString()} IQD`);
    console.log('');
    console.log('🎉 Hold is active! Money is now frozen.');
    console.log('');
    console.log('Next steps:');
    console.log('1. Complete the order delivery');
    console.log(`2. Capture hold: node test-capture-hold.js ${holdId}`);
    console.log(`3. Or release if cancelled: node test-release-hold.js ${holdId}`);
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      console.error('❌ Transaction failed!');
      console.error('Cancellation reasons:', JSON.stringify(error.CancellationReasons, null, 2));
      console.error('Possible reasons:');
      console.error('- Insufficient balance');
      console.error('- Concurrent wallet modification');
      console.error('- Hold ID already exists');
    } else {
      console.error('❌ Error creating hold:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

// Run the test
createHold(driverId, amount, orderId).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
