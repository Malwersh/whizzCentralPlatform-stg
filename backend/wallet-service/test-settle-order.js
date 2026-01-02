#!/usr/bin/env node

/**
 * Test Script: Settle Order
 * 
 * Settles a captured hold by transferring platform fee from driver to platform
 * 
 * Usage:
 *   node test-settle-order.js <orderId> <driverId> <platformFeeAmount>
 * 
 * Example:
 *   node test-settle-order.js ORD123 DRV001 500
 *   node test-settle-order.js ORD789 DRV001 700
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');

// Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const AWS_PROFILE = process.env.AWS_PROFILE || 'Wizz_dev_UserApp';

const TABLES = {
  WALLETS: 'dev-Wallets',
  LEDGER: 'dev-LedgerEntries',
  HOLDS: 'dev-Holds',
  AUDIT_LOG: 'dev-AuditLog',
};

// Initialize DynamoDB client
const client = new DynamoDBClient({
  region: AWS_REGION,
  credentials: process.env.AWS_PROFILE ? undefined : {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

// Helper functions
function getCurrentTimestamp() {
  return new Date().toISOString();
}

function generateTxnId() {
  return `txn_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function generateLedgerSK(timestamp, suffix) {
  return `ts#${timestamp}#${suffix}`;
}

function generateDatePartition() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `date#${year}${month}${day}`;
}

function formatAmount(amount) {
  return `${amount.toLocaleString()} IQD`;
}

async function getWallet(walletId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.WALLETS,
      Key: { walletId, sk: 'META' },
    })
  );
  return result.Item;
}

async function getHold(orderId) {
  const result = await docClient.send(
    new GetCommand({
      TableName: TABLES.HOLDS,
      Key: { orderId, sk: 'META' },
    })
  );
  return result.Item;
}

async function settleOrder(orderId, driverId, platformFeeAmount) {
  console.log(`\n💰 Settling Order`);
  console.log(`================`);
  console.log(`Order ID: ${orderId}`);
  console.log(`Driver ID: ${driverId}`);
  console.log(`Platform Fee: ${formatAmount(platformFeeAmount)}`);

  const timestamp = getCurrentTimestamp();
  const txnId = generateTxnId();

  // 1. Get hold
  console.log(`\n📋 Getting hold details...`);
  const hold = await getHold(orderId);

  if (!hold) {
    console.error(`❌ Hold not found for order ${orderId}`);
    process.exit(1);
  }

  console.log(`Hold Status: ${hold.status}`);
  console.log(`Captured Amount: ${formatAmount(hold.capturedAmount || 0)}`);

  if (hold.status !== 'CAPTURED') {
    console.error(`❌ Hold must be CAPTURED to settle. Current status: ${hold.status}`);
    process.exit(1);
  }

  if (!hold.capturedAmount) {
    console.error(`❌ Hold has no captured amount`);
    process.exit(1);
  }

  if (platformFeeAmount > hold.capturedAmount) {
    console.error(
      `❌ Platform fee ${formatAmount(platformFeeAmount)} exceeds captured amount ${formatAmount(hold.capturedAmount)}`
    );
    process.exit(1);
  }

  // 2. Get wallets
  const driverWalletId = hold.walletId;
  const platformWalletId = 'WALLET#PLATFORM';

  console.log(`\n📊 Getting wallet balances...`);
  const [driverWallet, platformWallet] = await Promise.all([
    getWallet(driverWalletId),
    getWallet(platformWalletId),
  ]);

  if (!driverWallet) {
    console.error(`❌ Driver wallet not found: ${driverWalletId}`);
    process.exit(1);
  }

  if (!platformWallet) {
    console.error(`❌ Platform wallet not found`);
    process.exit(1);
  }

  console.log(`Driver Balance (Before): ${formatAmount(driverWallet.availableBalance)}`);
  console.log(`Platform Balance (Before): ${formatAmount(platformWallet.availableBalance)}`);

  if (driverWallet.availableBalance < platformFeeAmount) {
    console.error(
      `❌ Insufficient balance. Available: ${formatAmount(driverWallet.availableBalance)}, Required: ${formatAmount(platformFeeAmount)}`
    );
    process.exit(1);
  }

  // 3. Prepare settlement
  const settlementId = `SETTLEMENT#${orderId}`;
  const driverNetAmount = hold.capturedAmount - platformFeeAmount;

  const settlement = {
    orderId, // Use orderId as primary key (same as hold)
    sk: 'SETTLEMENT', // Different sk from hold's META
    settlementId,
    holdId: hold.holdId,
    driverId,
    driverWalletId,
    platformWalletId,
    capturedAmount: hold.capturedAmount,
    platformFeeAmount,
    driverNetAmount,
    transactionId: txnId,
    status: 'COMPLETED',
    settledAt: timestamp,
    settledBy: 'ADMIN001',
    settledByRole: 'ADMIN',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  // 4. Prepare ledger entries
  const datePartition = generateDatePartition();
  const driverLedger = {
    walletId: driverWalletId,
    sk: generateLedgerSK(timestamp, 'SETTLEMENT_FEE'),
    transactionId: txnId,
    type: 'DEBIT',
    category: 'PLATFORM_FEE',
    amount: platformFeeAmount,
    balanceBefore: driverWallet.availableBalance,
    balanceAfter: driverWallet.availableBalance - platformFeeAmount,
    description: `Platform fee for order ${orderId}`,
    relatedEntityType: 'ORDER',
    relatedEntityId: orderId,
    createdAt: timestamp,
    metadata: {
      settlementId,
      orderId,
      capturedAmount: hold.capturedAmount,
      driverNetAmount,
    },
  };

  const platformLedger = {
    walletId: platformWalletId,
    sk: generateLedgerSK(timestamp, 'SETTLEMENT_FEE'),
    transactionId: txnId,
    type: 'CREDIT',
    category: 'PLATFORM_FEE',
    amount: platformFeeAmount,
    balanceBefore: platformWallet.availableBalance,
    balanceAfter: platformWallet.availableBalance + platformFeeAmount,
    description: `Platform fee collected from order ${orderId}`,
    relatedEntityType: 'ORDER',
    relatedEntityId: orderId,
    createdAt: timestamp,
    metadata: {
      settlementId,
      orderId,
      driverId,
      capturedAmount: hold.capturedAmount,
    },
  };

  // 5. Prepare audit log
  const auditLog = {
    logId: `AUDIT#${txnId}`,
    sk: `ts#${timestamp}`,
    datePartition,
    action: 'SETTLE_ORDER',
    entityType: 'SETTLEMENT',
    entityId: settlementId,
    performedBy: 'ADMIN001',
    performedByRole: 'ADMIN',
    timestamp,
    details: {
      orderId,
      driverId,
      capturedAmount: hold.capturedAmount,
      platformFeeAmount,
      driverNetAmount,
      transactionId: txnId,
    },
  };

  // 6. Execute atomic transaction
  console.log(`\n🔨 Executing settlement transaction...`);
  
  try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Update driver wallet
          {
            Update: {
              TableName: TABLES.WALLETS,
              Key: { walletId: driverWalletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance - :fee, #version = #version + :inc, updatedAt = :now',
              ConditionExpression:
                'attribute_exists(walletId) AND #version = :currentVersion AND availableBalance >= :fee',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':fee': platformFeeAmount,
                ':inc': 1,
                ':now': timestamp,
                ':currentVersion': driverWallet.version,
              },
            },
          },
          // Update platform wallet
          {
            Update: {
              TableName: TABLES.WALLETS,
              Key: { walletId: platformWalletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance + :fee, #version = #version + :inc, updatedAt = :now',
              ConditionExpression: 'attribute_exists(walletId) AND #version = :currentVersion',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':fee': platformFeeAmount,
                ':inc': 1,
                ':now': timestamp,
                ':currentVersion': platformWallet.version,
              },
            },
          },
          // Update hold status to SETTLED
          {
            Update: {
              TableName: TABLES.HOLDS,
              Key: { orderId, sk: 'META' },
              UpdateExpression: 'SET #status = :settled, settledAt = :now, updatedAt = :now',
              ConditionExpression: 'attribute_exists(orderId) AND #status = :captured',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':settled': 'SETTLED',
                ':captured': 'CAPTURED',
                ':now': timestamp,
              },
            },
          },
          // Create settlement record
          {
            Put: {
              TableName: TABLES.HOLDS,
              Item: settlement,
              ConditionExpression: 'attribute_not_exists(sk) OR sk <> :settlementSk',
              ExpressionAttributeValues: {
                ':settlementSk': 'SETTLEMENT',
              },
            },
          },
          // Driver ledger entry
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: driverLedger,
            },
          },
          // Platform ledger entry
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: platformLedger,
            },
          },
          // Audit log
          {
            Put: {
              TableName: TABLES.AUDIT_LOG,
              Item: auditLog,
            },
          },
        ],
      })
    );

    console.log(`✅ Settlement completed successfully!`);

    // Get updated balances
    const [updatedDriver, updatedPlatform] = await Promise.all([
      getWallet(driverWalletId),
      getWallet(platformWalletId),
    ]);

    console.log(`\n💰 Settlement Summary:`);
    console.log(`==================`);
    console.log(`Transaction ID: ${txnId}`);
    console.log(`Captured Amount: ${formatAmount(hold.capturedAmount)}`);
    console.log(`Platform Fee: ${formatAmount(platformFeeAmount)}`);
    console.log(`Driver Net Amount: ${formatAmount(driverNetAmount)}`);
    console.log(``);
    console.log(`Driver Balance: ${formatAmount(driverWallet.availableBalance)} → ${formatAmount(updatedDriver.availableBalance)}`);
    console.log(`Platform Balance: ${formatAmount(platformWallet.availableBalance)} → ${formatAmount(updatedPlatform.availableBalance)}`);
    console.log(``);
    console.log(`🎉 Platform fee successfully collected!`);

  } catch (error) {
    console.error(`\n❌ Settlement failed:`, error.message);
    if (error.name === 'TransactionCanceledException') {
      console.error(`Reason: Concurrent modification or invalid state`);
    }
    process.exit(1);
  }
}

// Main execution
const args = process.argv.slice(2);

if (args.length < 3) {
  console.error(`Usage: node test-settle-order.js <orderId> <driverId> <platformFeeAmount>`);
  console.error(`Example: node test-settle-order.js ORD123 DRV001 500`);
  process.exit(1);
}

const [orderId, driverId, platformFeeAmountStr] = args;
const platformFeeAmount = parseInt(platformFeeAmountStr, 10);

if (isNaN(platformFeeAmount) || platformFeeAmount <= 0) {
  console.error(`❌ Platform fee amount must be a positive number`);
  process.exit(1);
}

settleOrder(orderId, driverId, platformFeeAmount)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(`\n❌ Error:`, error);
    process.exit(1);
  });
