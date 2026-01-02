#!/usr/bin/env node

/**
 * Test Script - Capture Hold
 * 
 * Usage: node test-capture-hold.js <orderId> [actualAmount] [reason]
 * Example: node test-capture-hold.js ORD123 5000 "Order delivered successfully"
 * Example: node test-capture-hold.js ORD123 4500 "Partial delivery"
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
const actualAmount = process.argv[3] ? parseInt(process.argv[3]) : null;
const reason = process.argv[4] || 'Order delivered successfully';

if (!orderId) {
  console.error('❌ Error: Order ID is required');
  console.log('Usage: node test-capture-hold.js <orderId> [actualAmount] [reason]');
  console.log('Example: node test-capture-hold.js ORD123 5000 "Order delivered"');
  console.log('');
  console.log('If actualAmount is not provided, the full hold amount will be captured.');
  console.log('If actualAmount < hold amount, the difference will be released to available balance.');
  process.exit(1);
}

if (actualAmount !== null && (isNaN(actualAmount) || actualAmount <= 0)) {
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

async function captureHold(orderId, actualAmount, reason) {
  const timestamp = new Date().toISOString();

  console.log('💰 Capturing Hold');
  console.log('=================');
  console.log(`Order ID: ${orderId}`);
  if (actualAmount) {
    console.log(`Capture Amount: ${actualAmount.toLocaleString()} IQD`);
  } else {
    console.log('Capture Amount: Full hold amount');
  }
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
    console.log(`  Hold ID: ${holdId}`);
    console.log(`  Amount: ${hold.amount.toLocaleString()} IQD`);
    console.log(`  Status: ${hold.status}`);
    console.log(`  Created: ${hold.createdAt}`);
    console.log('');

    if (hold.status !== 'ACTIVE') {
      console.log(`❌ Hold cannot be captured. Current status: ${hold.status}`);
      return;
    }

    // Determine capture amount
    const captureAmount = actualAmount || hold.amount;

    if (captureAmount > hold.amount) {
      console.log('❌ Error: Capture amount cannot exceed hold amount!');
      console.log(`Hold Amount: ${hold.amount.toLocaleString()} IQD`);
      console.log(`Requested: ${captureAmount.toLocaleString()} IQD`);
      return;
    }

    const releaseAmount = hold.amount - captureAmount;

    console.log('💵 Capture Plan:');
    console.log(`  Capture: ${captureAmount.toLocaleString()} IQD (goes to platform/merchant)`);
    if (releaseAmount > 0) {
      console.log(`  Release: ${releaseAmount.toLocaleString()} IQD (returns to available balance)`);
    }
    console.log('');

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
      type: 'HOLD_CAPTURED',
      amount: -captureAmount, // Debit from locked
      balance: wallet.lockedBalance - captureAmount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold captured for settlement: ${reason}`,
      metadata: { holdId, orderId: hold.orderId, reason },
      timestamp,
    };

    // Prepare transaction items
    const transactions = [
      // Update hold status
      {
        Update: {
          TableName: HOLDS_TABLE,
          Key: { orderId: orderId, sk: 'META' },
          UpdateExpression:
            'SET #status = :captured, updatedAt = :timestamp, capturedAt = :timestamp, capturedAmount = :captureAmount',
          ConditionExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':captured': 'CAPTURED',
            ':active': 'ACTIVE',
            ':timestamp': timestamp,
            ':captureAmount': captureAmount,
          },
        },
      },
      // Update wallet - remove from locked
      {
        Update: {
          TableName: WALLETS_TABLE,
          Key: { walletId: hold.walletId, sk: 'META' },
          UpdateExpression:
            'SET lockedBalance = lockedBalance - :holdAmount, ' +
            (releaseAmount > 0 ? 'availableBalance = availableBalance + :releaseAmount, ' : '') +
            'updatedAt = :timestamp, ' +
            '#version = #version + :one',
          ConditionExpression: 'lockedBalance >= :holdAmount',
          ExpressionAttributeNames: {
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':holdAmount': hold.amount,
            ...(releaseAmount > 0 ? { ':releaseAmount': releaseAmount } : {}),
            ':timestamp': timestamp,
            ':one': 1,
          },
        },
      },
      // Record debit entry (captured amount)
      {
        Put: {
          TableName: LEDGER_TABLE,
          Item: debitEntry,
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
            action: 'HOLD_CAPTURED',
            walletId: hold.walletId,
            amount: captureAmount,
            holdId,
            orderId: hold.orderId,
            timestamp,
            metadata: { reason, releaseAmount },
          },
        },
      },
    ];

    // Add partial release entry if needed
    if (releaseAmount > 0) {
      transactions.push({
        Put: {
          TableName: LEDGER_TABLE,
          Item: {
            walletId: hold.walletId,
            sk: `ts#${timestamp}#1`,
            txnId,
            type: 'HOLD_PARTIAL_RELEASE',
            amount: releaseAmount,
            balance: wallet.availableBalance + releaseAmount,
            relatedEntityId: holdId,
            relatedEntityType: 'HOLD',
            description: `Partial hold release: ${releaseAmount} IQD`,
            metadata: { holdId, orderId: hold.orderId, captureAmount },
            timestamp,
          },
        },
      });
    }

    // Execute capture atomically
    console.log('🔨 Capturing hold...');
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactions,
      })
    );

    console.log('✅ Hold captured successfully!');
    console.log('');
    console.log('💰 New Balances:');
    console.log(`  Available: ${(wallet.availableBalance + releaseAmount).toLocaleString()} IQD${releaseAmount > 0 ? ` (+${releaseAmount.toLocaleString()} IQD)` : ''}`);
    console.log(`  Locked: ${(wallet.lockedBalance - hold.amount).toLocaleString()} IQD (-${hold.amount.toLocaleString()} IQD)`);
    console.log('');
    console.log('📝 Transaction Details:');
    console.log(`  Transaction ID: ${txnId}`);
    console.log(`  Amount Captured: ${captureAmount.toLocaleString()} IQD`);
    if (releaseAmount > 0) {
      console.log(`  Amount Released: ${releaseAmount.toLocaleString()} IQD`);
    }
    console.log(`  Reason: ${reason}`);
    console.log('');
    console.log('🎉 Hold has been captured!');
    console.log(`💵 ${captureAmount.toLocaleString()} IQD will be settled to platform/merchant.`);
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      console.error('❌ Transaction failed!');
      console.error('Cancellation reasons:', JSON.stringify(error.CancellationReasons, null, 2));
      console.error('Possible reasons:');
      console.error('- Hold is not in ACTIVE status');
      console.error('- Insufficient locked balance');
      console.error('- Concurrent modification');
    } else {
      console.error('❌ Error capturing hold:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

// Run the test
captureHold(orderId, actualAmount, reason).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
