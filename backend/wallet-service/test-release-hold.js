#!/usr/bin/env node

/**
 * Test Script - Release Hold
 * 
 * Usage: node test-release-hold.js <orderId> [reason]
 * Example: node test-release-hold.js ORD456 "Order cancelled by driver"
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
const orderId = process.argv[2];
const reason = process.argv[3] || 'Manual release';

if (!orderId) {
  console.error('❌ Error: Order ID is required');
  console.log('Usage: node test-release-hold.js <orderId> [reason]');
  console.log('Example: node test-release-hold.js ORD456 "Order cancelled"');
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

async function releaseHold(orderId, reason) {
  const timestamp = new Date().toISOString();

  console.log('🔓 Releasing Hold');
  console.log('================');
  console.log(`Order ID: ${orderId}`);
  console.log(`Reason: ${reason}`);
  console.log('');

  // Get hold details
  console.log('📋 Getting hold details...');
  try {
    const holdResult = await docClient.send(
      new GetCommand({
        TableName: HOLDS_TABLE,
        Key: {
          orderId: orderId,
          sk: 'META',
        },
      })
    );

    if (!holdResult.Item) {
      console.log('❌ Hold not found!');
      console.log(`Order ID: ${orderId}`);
      return;
    }

    const hold = holdResult.Item;
    const holdId = hold.holdId;

    console.log('Hold Details:');
    console.log(`  Order ID: ${hold.orderId}`);
    console.log(`  Amount: ${hold.amount.toLocaleString()} IQD`);
    console.log(`  Status: ${hold.status}`);
    console.log(`  Created: ${hold.createdAt}`);
    console.log('');

    if (hold.status !== 'ACTIVE') {
      console.log(`❌ Hold cannot be released. Current status: ${hold.status}`);
      return;
    }

    // Get wallet details
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: hold.walletId,
          sk: 'META',
        },
      })
    );

    if (!walletResult.Item) {
      console.log('❌ Wallet not found!');
      return;
    }

    const wallet = walletResult.Item;

    console.log('Current Wallet Balances:');
    console.log(`  Available: ${wallet.availableBalance.toLocaleString()} IQD`);
    console.log(`  Locked: ${wallet.lockedBalance.toLocaleString()} IQD`);
    console.log('');

    // Prepare ledger entries
    const txnId = `txn_${Date.now()}_${uuidv4().split('-')[0]}`;

    const debitEntry = {
      walletId: hold.walletId,
      sk: `ts#${timestamp}#0`,
      txnId,
      type: 'HOLD_RELEASED',
      amount: -hold.amount, // Debit from locked
      balance: wallet.lockedBalance - hold.amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold released: ${reason}`,
      metadata: { holdId, orderId: hold.orderId, reason },
      timestamp,
    };

    const creditEntry = {
      walletId: hold.walletId,
      sk: `ts#${timestamp}#1`,
      txnId,
      type: 'HOLD_RELEASED',
      amount: hold.amount, // Credit to available
      balance: wallet.availableBalance + hold.amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold released: ${reason}`,
      metadata: { holdId, orderId: hold.orderId, reason, balanceType: 'AVAILABLE' },
      timestamp,
    };

    // Release hold atomically
    console.log('🔨 Releasing hold...');
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Update hold status
          {
            Update: {
              TableName: HOLDS_TABLE,
              Key: { orderId: orderId, sk: 'META' },
              UpdateExpression:
                'SET #status = :released, updatedAt = :timestamp, releasedAt = :timestamp',
              ConditionExpression: '#status = :active',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':released': 'RELEASED',
                ':active': 'ACTIVE',
                ':timestamp': timestamp,
              },
            },
          },
          // Update wallet balances
          {
            Update: {
              TableName: WALLETS_TABLE,
              Key: { walletId: hold.walletId, sk: 'META' },
              UpdateExpression:
                'SET lockedBalance = lockedBalance - :amount, ' +
                'availableBalance = availableBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ConditionExpression: 'lockedBalance >= :amount',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': hold.amount,
                ':timestamp': timestamp,
                ':one': 1,
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
                action: 'HOLD_RELEASED',
                walletId: hold.walletId,
                amount: hold.amount,
                holdId,
                orderId: hold.orderId,
                timestamp,
                metadata: { reason },
              },
            },
          },
        ],
      })
    );

    console.log('✅ Hold released successfully!');
    console.log('');
    console.log('💰 New Balances:');
    console.log(`  Available: ${(wallet.availableBalance + hold.amount).toLocaleString()} IQD (+${hold.amount.toLocaleString()} IQD)`);
    console.log(`  Locked: ${(wallet.lockedBalance - hold.amount).toLocaleString()} IQD (-${hold.amount.toLocaleString()} IQD)`);
    console.log('');
    console.log('📝 Transaction Details:');
    console.log(`  Transaction ID: ${txnId}`);
    console.log(`  Amount Released: ${hold.amount.toLocaleString()} IQD`);
    console.log(`  Reason: ${reason}`);
    console.log('');
    console.log('🎉 Money has been returned to available balance!');
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      console.error('❌ Transaction failed!');
      console.error('Cancellation reasons:', JSON.stringify(error.CancellationReasons, null, 2));
      console.error('Possible reasons:');
      console.error('- Hold is not in ACTIVE status');
      console.error('- Insufficient locked balance');
      console.error('- Concurrent modification');
    } else {
      console.error('❌ Error releasing hold:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

// Run the test
releaseHold(orderId, reason).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
