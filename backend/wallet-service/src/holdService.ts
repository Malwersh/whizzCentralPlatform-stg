import {lifecycleJob,lifecycleCompletion} from './lifecycleJob';
import { docClient, TABLES, GetCommand, QueryCommand, ScanCommand, TransactWriteCommand } from './db';
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
  ConcurrentModificationError,
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
    
    const prior = await docClient.send(new GetCommand({TableName:TABLES.HOLDS,Key:{orderId,sk:'HOLD'},ConsistentRead:true}));
    if(prior.Item?.financialSchemaVersion!==undefined)throw new InvalidHoldStateError('FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT');
    if(prior.Item?.status==='ACTIVE'&&prior.Item.walletId===walletId&&prior.Item.amount===amount&&(prior.Item.metadata?.assignmentAttempt||1)===(assignmentAttempt||1))return {success:true,hold:prior.Item as Hold,message:'Hold already exists for this assignment'};

    const holdId = generateHoldId();
    const timestamp = getCurrentTimestamp();

    // Get current wallet state
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId, sk: 'META' },
        ConsistentRead: true,
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${walletId}`);
    }

    const wallet = walletResult.Item as Wallet;
    if(wallet.status!=='ACTIVE'||wallet.currency!=='IQD')throw new InvalidHoldStateError('Wallet is unavailable for a new hold');

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
      metadata: {...metadata,assignmentAttempt:assignmentAttempt||1},
      createdAt: timestamp,
      updatedAt: timestamp,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    };

    // Prepare ledger entries (double-entry)
    const txnId = generateTxnId();
    
    const debitEntry: LedgerEntry = {
      walletId,
      sk: generateLedgerSK(timestamp, 'HOLD_DEBIT#'+txnId),
      transactionId: txnId,
      type: 'DEBIT',
      category: 'HOLD_CREATED',
      amount: -amount,
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
      sk: generateLedgerSK(timestamp, 'HOLD_CREDIT#'+txnId),
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
            ...lifecycleJob(hold),
            {ConditionCheck:{TableName:process.env.ORDERS_TABLE || 'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},
              ConditionExpression:'attribute_not_exists(financialSnapshot) AND attribute_not_exists(financialAcceptance) AND attribute_not_exists(financialOutcome) AND attribute_not_exists(codFinancialEvidence)'}},
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
                  'availableBalance >= :amount AND #version = :currentVersion AND #walletStatus = :activeWallet AND currency = :currency',
                ExpressionAttributeNames: {
                  '#version': 'version',
                  '#walletStatus':'status',
                },
                ExpressionAttributeValues: {
                  ':amount': amount,
                  ':timestamp': timestamp,
                  ':one': 1,
                  ':currentVersion': wallet.version,
                  ':activeWallet':'ACTIVE',
                  ':currency':'IQD',
                },
              },
            },
            // Record debit entry
            {
              Put: {
                TableName: TABLES.LEDGER,
                Item: debitEntry,
                ConditionExpression: 'attribute_not_exists(sk)',
              },
            },
            // Record credit entry
            {
              Put: {
                TableName: TABLES.LEDGER,
                Item: creditEntry,
                ConditionExpression: 'attribute_not_exists(sk)',
              },
            },
            // Audit log
            {
              Put: {
                TableName: TABLES.AUDIT_LOG,
                Item: {
                  logId: `LOG#${txnId}`,
                  datePartition: generateDatePartition(new Date(timestamp)),
                  sk: timestamp+'#'+txnId,
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
        // Most common: repeated attempts for same order, or wallet balance/version changed.
        // Try to be deterministic and return a business 4xx instead of 500.

        // If the hold already exists for this order, return it (idempotent behavior).
        const existingHoldResult = await docClient.send(
          new GetCommand({
            TableName: TABLES.HOLDS,
            Key: { orderId, sk: 'HOLD' },
            ConsistentRead: true,
          })
        );

        if (existingHoldResult.Item?.financialSchemaVersion !== undefined) throw new InvalidHoldStateError('FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT');
        if (existingHoldResult.Item && existingHoldResult.Item.walletId === walletId && existingHoldResult.Item.amount === amount && existingHoldResult.Item.status === 'ACTIVE') {
          return {
            success: true,
            hold: existingHoldResult.Item as Hold,
            message: 'Hold already exists for this order (idempotent).',
          };
        }

        // Re-check wallet state to decide between insufficient funds vs. concurrency.
        const latestWalletResult = await docClient.send(
          new GetCommand({
            TableName: TABLES.WALLETS,
            Key: { walletId, sk: 'META' },
          })
        );

        const latestWallet = latestWalletResult.Item as Wallet | undefined;
        if (latestWallet && latestWallet.availableBalance < amount) {
          throw new InsufficientBalanceError(latestWallet.availableBalance, amount);
        }

        throw new ConcurrentModificationError('Insufficient balance or concurrent modification');
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
  async releaseHold(request: ReleaseHoldRequest, orderGuard?: any): Promise<ReleaseHoldResponse> {
    const { holdId, reason } = request;
    const timestamp = getCurrentTimestamp();

    // Query hold by holdId using GSI. If the index doesn't exist (legacy/staging tables), fall back to Scan.
    let queryResult:
      | { Items?: unknown[]; LastEvaluatedKey?: unknown }
      | undefined;

    try {
      queryResult = await docClient.send(
        new QueryCommand({
          TableName: TABLES.HOLDS,
          IndexName: 'byHoldId',
          KeyConditionExpression: 'holdId = :hid',
          ExpressionAttributeValues: {
            ':hid': holdId,
          },
        })
      );
    } catch (error: any) {
      const isMissingIndex =
        error?.name === 'ValidationException' &&
        typeof error?.message === 'string' &&
        error.message.includes('specified index') &&
        error.message.includes('byHoldId');

      if (!isMissingIndex) {
        throw error;
      }

      // IMPORTANT:
      // DynamoDB Scan's `Limit` caps *evaluated* items, not *returned* items.
      // With a FilterExpression, `Limit: 1` can easily return 0 matches even when the item exists.
      // So we paginate until we find the holdId or exhaust the table.
      let lastEvaluatedKey: unknown | undefined;
      do {
        queryResult = await docClient.send(
          new ScanCommand({
            TableName: TABLES.HOLDS,
            FilterExpression: 'holdId = :hid',
            ExpressionAttributeValues: {
              ':hid': holdId,
            },
            ExclusiveStartKey: lastEvaluatedKey as any,
            Limit: 100,
          })
        );

        if (queryResult.Items && queryResult.Items.length > 0) {
          break;
        }

        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);
    }

    if (!queryResult.Items || queryResult.Items.length === 0) {
      throw new HoldNotFoundError(`Hold not found: ${holdId}`);
    }

    const hold = queryResult.Items[0] as Hold;

    const canonical = await docClient.send(new GetCommand({TableName:TABLES.HOLDS,Key:{orderId:hold.orderId,sk:'HOLD'},ConsistentRead:true}));
    if (!canonical.Item || canonical.Item.holdId !== holdId) throw new InvalidHoldStateError('Hold replaced by another assignment');
    Object.assign(hold,canonical.Item);
    if ((hold as any).financialSchemaVersion !== undefined) throw new InvalidHoldStateError('FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT');

    if(hold.status==='RELEASED'){const current=await docClient.send(new GetCommand({TableName:TABLES.WALLETS,Key:{walletId:hold.walletId,sk:'META'},ConsistentRead:true}));if(!current.Item)throw new WalletNotFoundError('Wallet not found');return {success:true,holdId,message:'Hold already released',walletBalance:{available:current.Item.availableBalance,locked:current.Item.lockedBalance}};}
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
      sk: generateLedgerSK(timestamp, txnId+'#0'),
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
      sk: generateLedgerSK(timestamp, txnId+'#1'),
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
          ...(orderGuard ? [orderGuard] : []),
          ...lifecycleCompletion(hold,'RELEASED'),
          // Update hold status
          {
            Update: {
              TableName: TABLES.HOLDS,
              Key: { orderId: hold.orderId, sk: 'HOLD' },
              UpdateExpression: 
                'SET #status = :released, statusCreatedAt = :releasedStatus, updatedAt = :timestamp, releasedAt = :timestamp',
              ConditionExpression: '#status = :active AND holdId = :expectedHoldId',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':released': 'RELEASED',
                ':releasedStatus': `RELEASED#${timestamp}`,
                ':active': 'ACTIVE',
                ':expectedHoldId': holdId,
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
              ConditionExpression: 'lockedBalance >= :amount AND #version = :currentVersion',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': hold.amount,
                ':currentVersion': wallet.version,
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
                ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          // Record credit entry
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: creditEntry,
                ConditionExpression: 'attribute_not_exists(sk)',
            },
          },
          // Audit log
          {
            Put: {
              TableName: TABLES.AUDIT_LOG,
              Item: {
                logId: `LOG#${txnId}`,
                datePartition: generateDatePartition(new Date(timestamp)),
                sk: timestamp+'#'+txnId,
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
  async captureHold(request: CaptureHoldRequest, orderGuard?: any): Promise<CaptureHoldResponse> {
    const { holdId, actualAmount, reason } = request;
    const timestamp = getCurrentTimestamp();

    // Query hold by holdId using GSI. If the index doesn't exist (legacy/staging tables), fall back to Scan.
    let queryResult:
      | { Items?: unknown[]; LastEvaluatedKey?: unknown }
      | undefined;

    try {
      queryResult = await docClient.send(
        new QueryCommand({
          TableName: TABLES.HOLDS,
          IndexName: 'byHoldId',
          KeyConditionExpression: 'holdId = :hid',
          ExpressionAttributeValues: {
            ':hid': holdId,
          },
        })
      );
    } catch (error: any) {
      const isMissingIndex =
        error?.name === 'ValidationException' &&
        typeof error?.message === 'string' &&
        error.message.includes('specified index') &&
        error.message.includes('byHoldId');

      if (!isMissingIndex) {
        throw error;
      }

      let lastEvaluatedKey: unknown | undefined;
      do {
        queryResult = await docClient.send(
          new ScanCommand({
            TableName: TABLES.HOLDS,
            FilterExpression: 'holdId = :hid',
            ExpressionAttributeValues: {
              ':hid': holdId,
            },
            ExclusiveStartKey: lastEvaluatedKey as any,
            Limit: 100,
          })
        );

        if (queryResult.Items && queryResult.Items.length > 0) {
          break;
        }

        lastEvaluatedKey = queryResult.LastEvaluatedKey;
      } while (lastEvaluatedKey);
    }

    if (!queryResult?.Items || queryResult.Items.length === 0) {
      throw new HoldNotFoundError(`Hold not found: ${holdId}`);
    }

    const hold = queryResult.Items[0] as Hold;

    const canonical = await docClient.send(new GetCommand({TableName:TABLES.HOLDS,Key:{orderId:hold.orderId,sk:'HOLD'},ConsistentRead:true}));
    if (!canonical.Item || canonical.Item.holdId !== holdId) throw new InvalidHoldStateError('Hold replaced by another assignment');
    Object.assign(hold,canonical.Item);
    if ((hold as any).financialSchemaVersion !== undefined) throw new InvalidHoldStateError('FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT');

    if(hold.status==='CAPTURED'){if(actualAmount!==undefined&&actualAmount!==hold.capturedAmount)throw new InvalidHoldStateError('Capture amount differs from completed capture');return {success:true,holdId,capturedAmount:hold.capturedAmount!,releasedAmount:hold.amount-hold.capturedAmount!,message:'Hold already captured'};}
    // Check hold state
    if (hold.status !== 'ACTIVE') {
      throw new InvalidHoldStateError(
        `Hold cannot be captured. Current status: ${hold.status}`
      );
    }

    // Use actual amount or full hold amount
    const captureAmount = actualAmount ?? hold.amount;
    validateAmount(captureAmount);

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
      sk: generateLedgerSK(timestamp, txnId+'#0'),
      txnId,
      transactionId: txnId,
      type: 'HOLD_CAPTURED',
      amount: -hold.amount, // Remove the entire hold; partial remainder is credited separately
      balance: wallet.lockedBalance - hold.amount,
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
      sk: generateLedgerSK(timestamp, txnId+'#1'),
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
      ...(orderGuard ? [orderGuard] : []),
      ...lifecycleCompletion(hold,'CAPTURED'),
      // Update hold status
      {
        Update: {
          TableName: TABLES.HOLDS,
          Key: { orderId: hold.orderId, sk: 'HOLD' },
          UpdateExpression:
            'SET #status = :captured, statusCreatedAt = :capturedStatus, updatedAt = :timestamp, capturedAt = :timestamp, capturedAmount = :captureAmount',
          ConditionExpression: '#status = :active AND holdId = :expectedHoldId',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':captured': 'CAPTURED',
            ':capturedStatus': `CAPTURED#${timestamp}`,
            ':active': 'ACTIVE',
                ':expectedHoldId': holdId,
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
          ConditionExpression: 'lockedBalance >= :holdAmount AND #version = :currentVersion',
          ExpressionAttributeNames: {
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':holdAmount': hold.amount,
            ':currentVersion': wallet.version,
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
          ConditionExpression: '#version = :currentVersion',
          ExpressionAttributeNames: {
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':captureAmount': captureAmount,
            ':currentVersion': platformWallet.version,
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
                ConditionExpression: 'attribute_not_exists(sk)',
        },
      },
      // Record platform credit entry
      {
        Put: {
          TableName: TABLES.LEDGER,
          Item: platformCreditEntry,
                ConditionExpression: 'attribute_not_exists(sk)',
        },
      },
      // Audit log
      {
        Put: {
          TableName: TABLES.AUDIT_LOG,
          Item: {
            logId: `LOG#${txnId}`,
            datePartition: generateDatePartition(new Date(timestamp)),
            sk: timestamp+'#'+txnId,
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
            sk: generateLedgerSK(timestamp, txnId+'#1'),
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
          ConditionExpression: 'attribute_not_exists(sk)',
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
