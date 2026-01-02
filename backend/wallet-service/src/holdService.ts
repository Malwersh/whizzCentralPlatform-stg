import { docClient, TABLES, GetCommand, QueryCommand, TransactWriteCommand } from './db';
import {
  Hold,
  Wallet,
  LedgerEntry,
  CreateHoldRequest,
  CreateHoldResponse,
  ReleaseHoldRequest,
  ReleaseHoldResponse,
  CaptureHoldRequest,
  CaptureHoldResponse,
  GetActiveHoldsResponse,
  WalletNotFoundError,
  InsufficientBalanceError,
  HoldNotFoundError,
  InvalidHoldStateError,
} from './types';
import {
  generateHoldId,
  generateTxnId,
  generateLedgerSK,
  getCurrentTimestamp,
  validateAmount,
  generateDatePartition,
} from './utils';

/**
 * Hold Service - Money Hold Operations
 * 
 * Handles:
 * - Creating holds (freezing money)
 * - Releasing holds (unfreezing)
 * - Capturing holds (converting to settlement)
 * - Querying active holds
 */
export class HoldService {
  /**
   * Create a hold - Freeze money in driver's wallet
   * 
   * Flow:
   * 1. Validate amount
   * 2. Check wallet exists and has sufficient balance
   * 3. Create hold record
   * 4. Move money from available to locked (atomic)
   * 5. Record in ledger
   */
  async createHold(request: CreateHoldRequest): Promise<CreateHoldResponse> {
    const { walletId, amount, orderId, reason, metadata, assignmentAttempt } = request;

    // Validate
    validateAmount(amount);
    
    const holdId = generateHoldId();
    const timestamp = getCurrentTimestamp();

    // Get current wallet state
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId, sk: 'META' },
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${walletId}`);
    }

    const wallet = walletResult.Item as Wallet;

    // Check sufficient balance
    if (wallet.availableBalance < amount) {
      throw new InsufficientBalanceError(wallet.availableBalance, amount);
    }

    // Prepare hold record
    const hold: Hold = {
      orderId,
      sk: 'HOLD',
      holdId,
      walletId,
      amount,
      status: 'ACTIVE',
      statusCreatedAt: `ACTIVE#${timestamp}`, // For GSI sorting
      reason: reason || 'Order delivery fee hold',
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    };

    // Prepare ledger entries (double-entry)
    const txnId = generateTxnId();
    
    const debitEntry: LedgerEntry = {
      walletId,
      sk: generateLedgerSK(timestamp, 'HOLD_DEBIT'),
      transactionId: txnId,
      type: 'DEBIT',
      category: 'HOLD_CREATED',
      amount: amount,
      balanceBefore: wallet.availableBalance,
      balanceAfter: wallet.availableBalance - amount,
      relatedEntityId: orderId,
      relatedEntityType: 'HOLD',
      description: `Hold created for order ${orderId}`,
      metadata: { orderId, holdId },
      createdAt: timestamp,
    };

    const creditEntry: LedgerEntry = {
      walletId,
      sk: generateLedgerSK(timestamp, 'HOLD_CREDIT'),
      transactionId: txnId,
      type: 'CREDIT',
      category: 'HOLD_CREATED',
      amount: amount,
      balanceBefore: wallet.lockedBalance,
      balanceAfter: wallet.lockedBalance + amount,
      relatedEntityId: orderId,
      relatedEntityType: 'HOLD',
      description: `Hold locked for order ${orderId}`,
      metadata: { orderId, holdId, balanceType: 'LOCKED' },
      createdAt: timestamp,
    };

    // Atomic transaction
    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            // Create hold - Allow if no hold exists OR previous hold is RELEASED
            {
              Put: {
                TableName: TABLES.HOLDS,
                Item: hold,
                ConditionExpression: 'attribute_not_exists(sk) OR #status = :released',
                ExpressionAttributeNames: {
                  '#status': 'status',
                },
                ExpressionAttributeValues: {
                  ':released': 'RELEASED',
                },
              },
            },
            // Update wallet balances
            {
              Update: {
                TableName: TABLES.WALLETS,
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
                TableName: TABLES.LEDGER,
                Item: debitEntry,
              },
            },
            // Record credit entry
            {
              Put: {
                TableName: TABLES.LEDGER,
                Item: creditEntry,
              },
            },
            // Audit log
            {
              Put: {
                TableName: TABLES.AUDIT_LOG,
                Item: {
                  logId: `LOG#${txnId}`,
                  datePartition: generateDatePartition(new Date(timestamp)),
                  sk: timestamp,
                  action: 'HOLD_CREATED',
                  walletId,
                  amount,
                  holdId,
                  orderId,
                  timestamp,
                  metadata: { reason },
                },
              },
            },
            // Idempotency key - FIXED: Include walletId + assignmentAttempt to allow new holds for reassignments
            {
              Put: {
                TableName: TABLES.IDEMPOTENCY_KEYS,
                Item: {
                  idempotencyKey: `HOLD_CREATE#${orderId}#${walletId}${assignmentAttempt ? `#A${assignmentAttempt}` : ''}`,
                  sk: 'META',
                  resourceType: 'HOLD',
                  resourceId: holdId,
                  status: 'COMPLETED',
                  createdAt: timestamp,
                  expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
                  ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60), // 24 hours
                },
                ConditionExpression: 'attribute_not_exists(idempotencyKey)',
              },
            },
          ],
        })
      );

      return {
        success: true,
        hold,
        message: `Hold created successfully: ${amount} IQD`,
      };
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        if (reasons.some((r: any) => r.Code === 'ConditionalCheckFailed')) {
          throw new Error('Insufficient balance or concurrent modification');
        }
      }
      throw error;
    }
  }

  /**
   * Release a hold - Return money to available balance
   * 
   * Use cases:
   * - Order cancelled
   * - Delivery failed
   * - Hold expired
   */
  async releaseHold(request: ReleaseHoldRequest): Promise<ReleaseHoldResponse> {
    const { holdId, reason } = request;
    const timestamp = getCurrentTimestamp();

    // Query hold by holdId using GSI
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLES.HOLDS,
        IndexName: 'byHoldId',
        KeyConditionExpression: 'holdId = :hid',
        ExpressionAttributeValues: {
          ':hid': holdId,
        },
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      throw new HoldNotFoundError(`Hold not found: ${holdId}`);
    }

    const hold = queryResult.Items[0] as Hold;

    // Check hold state
    if (hold.status !== 'ACTIVE') {
      throw new InvalidHoldStateError(
        `Hold cannot be released. Current status: ${hold.status}`
      );
    }

    // Get wallet
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId: hold.walletId, sk: 'META' },
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${hold.walletId}`);
    }

    const wallet = walletResult.Item as Wallet;

    // Prepare ledger entries
    const txnId = generateTxnId();

    const debitEntry: LedgerEntry = {
      walletId: hold.walletId,
      sk: generateLedgerSK(timestamp, '0'),
      txnId,
      transactionId: txnId,
      type: 'HOLD_RELEASED',
      amount: -hold.amount, // Debit from locked
      balance: wallet.lockedBalance - hold.amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold released: ${reason || 'Manual release'}`,
      metadata: { holdId, orderId: hold.orderId, reason },
      timestamp,
      createdAt: timestamp,
    };

    const creditEntry: LedgerEntry = {
      walletId: hold.walletId,
      sk: generateLedgerSK(timestamp, '1'),
      txnId,
      transactionId: txnId,
      type: 'HOLD_RELEASED',
      amount: hold.amount, // Credit to available
      balance: wallet.availableBalance + hold.amount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold released: ${reason || 'Manual release'}`,
      metadata: { holdId, orderId: hold.orderId, reason, balanceType: 'AVAILABLE' },
      timestamp,
      createdAt: timestamp,
    };

    // Atomic transaction
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          // Update hold status
          {
            Update: {
              TableName: TABLES.HOLDS,
              Key: { orderId: hold.orderId, sk: 'HOLD' },
              UpdateExpression: 
                'SET #status = :released, statusCreatedAt = :releasedStatus, updatedAt = :timestamp, releasedAt = :timestamp',
              ConditionExpression: '#status = :active',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':released': 'RELEASED',
                ':releasedStatus': `RELEASED#${timestamp}`,
                ':active': 'ACTIVE',
                ':timestamp': timestamp,
              },
            },
          },
          // Update wallet balances
          {
            Update: {
              TableName: TABLES.WALLETS,
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
              TableName: TABLES.LEDGER,
              Item: debitEntry,
            },
          },
          // Record credit entry
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: creditEntry,
            },
          },
          // Audit log
          {
            Put: {
              TableName: TABLES.AUDIT_LOG,
              Item: {
                logId: `LOG#${txnId}`,
                datePartition: generateDatePartition(new Date(timestamp)),
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

    return {
      success: true,
      holdId,
      message: `Hold released successfully: ${hold.amount} IQD`,
      walletBalance: {
        available: wallet.availableBalance + hold.amount,
        locked: wallet.lockedBalance - hold.amount,
      },
    };
  }

  /**
   * Capture a hold - Convert to settlement
   * 
   * Use case:
   * - Order delivered successfully
   * - Money transfers from driver to platform/merchant
   */
  async captureHold(request: CaptureHoldRequest): Promise<CaptureHoldResponse> {
    const { holdId, actualAmount, reason } = request;
    const timestamp = getCurrentTimestamp();

    // Query hold by holdId using GSI
    const queryResult = await docClient.send(
      new QueryCommand({
        TableName: TABLES.HOLDS,
        IndexName: 'byHoldId',
        KeyConditionExpression: 'holdId = :hid',
        ExpressionAttributeValues: {
          ':hid': holdId,
        },
      })
    );

    if (!queryResult.Items || queryResult.Items.length === 0) {
      throw new HoldNotFoundError(`Hold not found: ${holdId}`);
    }

    const hold = queryResult.Items[0] as Hold;

    // Check hold state
    if (hold.status !== 'ACTIVE') {
      throw new InvalidHoldStateError(
        `Hold cannot be captured. Current status: ${hold.status}`
      );
    }

    // Use actual amount or full hold amount
    const captureAmount = actualAmount || hold.amount;

    if (captureAmount > hold.amount) {
      throw new Error('Capture amount cannot exceed hold amount');
    }

    // Get wallet
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId: hold.walletId, sk: 'META' },
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${hold.walletId}`);
    }

    const wallet = walletResult.Item as Wallet;

    // Get platform wallet
    const platformWalletId = 'WALLET#PLATFORM';
    const platformWalletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId: platformWalletId, sk: 'META' },
      })
    );

    if (!platformWalletResult.Item) {
      throw new WalletNotFoundError(`Platform wallet not found: ${platformWalletId}`);
    }

    const platformWallet = platformWalletResult.Item as Wallet;

    // Prepare ledger entries
    const txnId = generateTxnId();

    const debitEntry: LedgerEntry = {
      walletId: hold.walletId,
      sk: generateLedgerSK(timestamp, '0'),
      txnId,
      transactionId: txnId,
      type: 'HOLD_CAPTURED',
      amount: -captureAmount, // Debit from locked
      balance: wallet.lockedBalance - captureAmount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Hold captured for settlement: ${reason || 'Order completed'}`,
      metadata: { holdId, orderId: hold.orderId, reason },
      timestamp,
      createdAt: timestamp,
    };

    // Credit platform wallet
    const platformCreditEntry: LedgerEntry = {
      walletId: platformWalletId,
      sk: generateLedgerSK(timestamp, '1'),
      txnId,
      transactionId: txnId,
      type: 'SETTLEMENT_RECEIVED',
      amount: captureAmount, // Credit to platform
      balance: platformWallet.availableBalance + captureAmount,
      relatedEntityId: holdId,
      relatedEntityType: 'HOLD',
      description: `Settlement received from driver for order ${hold.orderId}`,
      metadata: { holdId, orderId: hold.orderId, driverWalletId: hold.walletId },
      timestamp,
      createdAt: timestamp,
    };

    // If partial capture, release the remaining amount
    const releaseAmount = hold.amount - captureAmount;
    const transactions: any[] = [
      // Update hold status
      {
        Update: {
          TableName: TABLES.HOLDS,
          Key: { orderId: hold.orderId, sk: 'HOLD' },
          UpdateExpression:
            'SET #status = :captured, statusCreatedAt = :capturedStatus, updatedAt = :timestamp, capturedAt = :timestamp, capturedAmount = :captureAmount',
          ConditionExpression: '#status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':captured': 'CAPTURED',
            ':capturedStatus': `CAPTURED#${timestamp}`,
            ':active': 'ACTIVE',
            ':timestamp': timestamp,
            ':captureAmount': captureAmount,
          },
        },
      },
      // Update driver wallet - remove from locked
      {
        Update: {
          TableName: TABLES.WALLETS,
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
      // Update platform wallet - add to available
      {
        Update: {
          TableName: TABLES.WALLETS,
          Key: { walletId: platformWalletId, sk: 'META' },
          UpdateExpression:
            'SET availableBalance = availableBalance + :captureAmount, ' +
            'updatedAt = :timestamp, ' +
            '#version = #version + :one',
          ExpressionAttributeNames: {
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':captureAmount': captureAmount,
            ':timestamp': timestamp,
            ':one': 1,
          },
        },
      },
      // Record driver debit entry
      {
        Put: {
          TableName: TABLES.LEDGER,
          Item: debitEntry,
        },
      },
      // Record platform credit entry
      {
        Put: {
          TableName: TABLES.LEDGER,
          Item: platformCreditEntry,
        },
      },
      // Audit log
      {
        Put: {
          TableName: TABLES.AUDIT_LOG,
          Item: {
            logId: `LOG#${txnId}`,
            datePartition: generateDatePartition(new Date(timestamp)),
            sk: timestamp,
            action: 'HOLD_CAPTURED',
            walletId: hold.walletId,
            amount: captureAmount,
            holdId,
            orderId: hold.orderId,
            timestamp,
            metadata: { 
              reason, 
              releaseAmount, 
              platformWalletId,
              driverWalletId: hold.walletId 
            },
          },
        },
      },
    ];

    // Add release entry if partial capture
    if (releaseAmount > 0) {
      transactions.push({
        Put: {
          TableName: TABLES.LEDGER,
          Item: {
            walletId: hold.walletId,
            sk: generateLedgerSK(timestamp, '1'),
            txnId,
            transactionId: txnId,
            type: 'HOLD_PARTIAL_RELEASE',
            amount: releaseAmount,
            balance: wallet.availableBalance + releaseAmount,
            relatedEntityId: holdId,
            relatedEntityType: 'HOLD',
            description: `Partial hold release: ${releaseAmount} IQD`,
            metadata: { holdId, orderId: hold.orderId, captureAmount },
            timestamp,
            createdAt: timestamp,
          } as LedgerEntry,
        },
      });
    }

    // Atomic transaction
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: transactions,
      })
    );

    return {
      success: true,
      holdId,
      capturedAmount: captureAmount,
      releasedAmount: releaseAmount,
      message: `Hold captured successfully: ${captureAmount} IQD${releaseAmount > 0 ? `, ${releaseAmount} IQD released` : ''}`,
    };
  }

  /**
   * Get active holds for a driver
   */
  async getActiveHolds(driverId: string): Promise<GetActiveHoldsResponse> {
    const walletId = `WALLET#DRIVER#${driverId}`;

    // Query holds by walletId and status using GSI
    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.HOLDS,
        IndexName: 'byWalletIdActive',
        KeyConditionExpression: 'walletId = :walletId AND begins_with(statusCreatedAt, :active)',
        ExpressionAttributeValues: {
          ':walletId': walletId,
          ':active': 'ACTIVE#',
        },
        ScanIndexForward: false, // Most recent first
      })
    );

    const holds = (result.Items || []) as Hold[];

    const totalLocked = holds.reduce((sum, hold) => sum + hold.amount, 0);

    return {
      success: true,
      holds,
      totalLocked,
      count: holds.length,
    };
  }
}
