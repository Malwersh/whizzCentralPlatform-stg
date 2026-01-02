#!/usr/bin/env node

/**
 * Test Script - Approve Topup Request
 * 
 * Usage: node test-approve-topup.js <topupId> <adminId> [note]
 * Example: node test-approve-topup.js TOPUP#123456#abc ADMIN001 "Evidence verified"
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');

// Configuration
const REGION = process.env.AWS_REGION || 'us-east-1';
const ENVIRONMENT = process.env.ENVIRONMENT || 'dev';
const WALLETS_TABLE = `${ENVIRONMENT}-Wallets`;
const TOPUP_REQUESTS_TABLE = `${ENVIRONMENT}-TopupRequests`;
const LEDGER_TABLE = `${ENVIRONMENT}-LedgerEntries`;
const AUDIT_TABLE = `${ENVIRONMENT}-AuditLog`;

// Get parameters from command line
const topupId = process.argv[2];
const adminId = process.argv[3];
const note = process.argv[4] || 'Approved';

if (!topupId || !adminId) {
  console.error('❌ Error: Topup ID and Admin ID are required');
  console.log('Usage: node test-approve-topup.js <topupId> <adminId> [note]');
  console.log('Example: node test-approve-topup.js TOPUP#123456#abc ADMIN001 "Verified"');
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

async function approveTopup(topupId, adminId, note) {
  const timestamp = new Date().toISOString();

  console.log('✅ Approving Topup Request');
  console.log('=========================');
  console.log(`Topup ID: ${topupId}`);
  console.log(`Admin ID: ${adminId}`);
  console.log(`Note: ${note}`);
  console.log('');

  // Get topup request
  console.log('📋 Getting topup request...');
  try {
    const topupResult = await docClient.send(
      new GetCommand({
        TableName: TOPUP_REQUESTS_TABLE,
        Key: {
          topupId: topupId,
          sk: 'META',
        },
      })
    );

    if (!topupResult.Item) {
      console.log('❌ Topup request not found!');
      return;
    }

    const topup = topupResult.Item;

    console.log('Topup Request Details:');
    console.log(`  Driver ID: ${topup.driverId}`);
    console.log(`  Amount: ${topup.amount.toLocaleString()} IQD`);
    console.log(`  Method: ${topup.method}`);
    console.log(`  Status: ${topup.status}`);
    console.log(`  Created: ${topup.createdAt}`);
    console.log('');

    if (topup.status !== 'PENDING') {
      console.log(`❌ Cannot approve. Current status: ${topup.status}`);
      return;
    }

    // Get driver wallet
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: topup.walletId,
          sk: 'META',
        },
      })
    );

    if (!walletResult.Item) {
      console.log('❌ Wallet not found!');
      return;
    }

    const wallet = walletResult.Item;

    // Get platform wallet
    const platformWalletId = 'WALLET#PLATFORM';
    const platformWalletResult = await docClient.send(
      new GetCommand({
        TableName: WALLETS_TABLE,
        Key: {
          walletId: platformWalletId,
          sk: 'META',
        },
      })
    );

    if (!platformWalletResult.Item) {
      console.log('❌ Platform wallet not found!');
      return;
    }

    const platformWallet = platformWalletResult.Item;

    console.log('Current Balances:');
    console.log(`  Driver: ${wallet.availableBalance.toLocaleString()} IQD`);
    console.log(`  Platform: ${platformWallet.availableBalance.toLocaleString()} IQD`);
    console.log('');

    // Prepare transaction
    const txnId = `txn_${Date.now()}_${uuidv4().split('-')[0]}`;

    const driverCreditEntry = {
      walletId: topup.walletId,
      sk: `ts#${timestamp}#0`,
      txnId,
      type: 'TOPUP',
      amount: topup.amount,
      balance: wallet.availableBalance + topup.amount,
      relatedEntityId: topupId,
      relatedEntityType: 'TOPUP',
      description: `Topup approved: ${topup.amount} IQD`,
      metadata: { topupId, method: topup.method, approvedById: adminId },
      timestamp,
    };

    const platformCreditEntry = {
      walletId: platformWalletId,
      sk: `ts#${timestamp}#0`,
      txnId,
      type: 'TOPUP',
      amount: topup.amount,
      balance: platformWallet.availableBalance + topup.amount,
      relatedEntityId: topupId,
      relatedEntityType: 'TOPUP',
      description: `Topup cash received from driver ${topup.driverId}`,
      metadata: { topupId, driverId: topup.driverId, method: topup.method },
      timestamp,
    };

    console.log('🔨 Approving and crediting balance...');
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Update topup status
          {
            Update: {
              TableName: TOPUP_REQUESTS_TABLE,
              Key: { topupId, sk: 'META' },
              UpdateExpression:
                'SET #status = :approved, updatedAt = :timestamp, ' +
                'approvedAt = :timestamp, approvedById = :approvedById, ' +
                'approvedByRole = :approvedByRole, approvalNote = :note',
              ConditionExpression: '#status = :pending',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':approved': 'APPROVED',
                ':pending': 'PENDING',
                ':timestamp': timestamp,
                ':approvedById': adminId,
                ':approvedByRole': 'ADMIN',
                ':note': note,
              },
            },
          },
          // Update driver wallet
          {
            Update: {
              TableName: WALLETS_TABLE,
              Key: { walletId: topup.walletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': topup.amount,
                ':timestamp': timestamp,
                ':one': 1,
              },
            },
          },
          // Update platform wallet
          {
            Update: {
              TableName: WALLETS_TABLE,
              Key: { walletId: platformWalletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': topup.amount,
                ':timestamp': timestamp,
                ':one': 1,
              },
            },
          },
          // Record driver ledger
          {
            Put: {
              TableName: LEDGER_TABLE,
              Item: driverCreditEntry,
            },
          },
          // Record platform ledger
          {
            Put: {
              TableName: LEDGER_TABLE,
              Item: platformCreditEntry,
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
                action: 'TOPUP_APPROVED',
                walletId: topup.walletId,
                amount: topup.amount,
                topupId,
                timestamp,
                metadata: { driverId: topup.driverId, approvedById: adminId },
              },
            },
          },
        ],
      })
    );

    console.log('✅ Topup approved successfully!');
    console.log('');
    console.log('💰 New Balances:');
    console.log(`  Driver: ${(wallet.availableBalance + topup.amount).toLocaleString()} IQD (+${topup.amount.toLocaleString()} IQD)`);
    console.log(`  Platform: ${(platformWallet.availableBalance + topup.amount).toLocaleString()} IQD (+${topup.amount.toLocaleString()} IQD)`);
    console.log('');
    console.log('📝 Transaction Details:');
    console.log(`  Transaction ID: ${txnId}`);
    console.log(`  Amount Added: ${topup.amount.toLocaleString()} IQD`);
    console.log(`  Approved By: ${adminId}`);
    console.log(`  Note: ${note}`);
    console.log('');
    console.log('🎉 Balance has been credited to driver wallet!');
  } catch (error) {
    if (error.name === 'TransactionCanceledException') {
      console.error('❌ Transaction failed!');
      console.error('Cancellation reasons:', JSON.stringify(error.CancellationReasons, null, 2));
      console.error('Possible reasons:');
      console.error('- Topup is not in PENDING status');
      console.error('- Concurrent modification');
    } else {
      console.error('❌ Error approving topup:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  }
}

// Run the test
approveTopup(topupId, adminId, note).catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
