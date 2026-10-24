import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { docClient, TABLES } from './db';
import { 
  Settlement, 
  Hold, 
  Wallet,
  LedgerEntry, 
  AuditLog,
  SettleOrderRequest,
  SettleOrderResponse,
  GetSettlementsResponse,
  HoldNotFoundError,
  InvalidHoldStateError,
  InsufficientBalanceError,
  WalletNotFoundError,
  SettlementError
} from './types';
import { 
  generateTxnId, 
  getPlatformWalletId,
  generateLedgerSK,
  generateDatePartition,
  getCurrentTimestamp,
  validateAmount,
  formatAmount
} from './utils';

/**
 * Settlement Service
 * 
 * Handles order settlement and platform fee collection.
 * 
 * Key Features:
 * - Settles captured holds by transferring platform fee
 * - Transfers fees from driver wallet to platform wallet
 * - Updates hold status to SETTLED
 * - Records double-entry ledger entries
 * - Maintains audit trail
 * 
 * Settlement Flow:
 * 1. Verify hold is CAPTURED
 * 2. Calculate platform fee
 * 3. Atomic transaction:
 *    - Debit driver wallet (platform fee)
 *    - Credit platform wallet (platform fee)
 *    - Update hold status to SETTLED
 *    - Create ledger entries
 *    - Log audit trail
 */
export class SettlementService {
  private client: DynamoDBDocumentClient;

  constructor(client: DynamoDBDocumentClient = docClient) {
    this.client = client;
  }

  /**
   * Settle an order by transferring platform fee from driver to platform
   * 
   * @param orderId - Order identifier
   * @param driverId - Driver identifier
   * @param platformFeeAmount - Platform fee to collect (in IQD fils)
   * @param metadata - Optional settlement metadata
   * @returns Settlement details
   * 
   * @throws {HoldNotFoundError} If hold doesn't exist
   * @throws {InvalidHoldStateError} If hold is not CAPTURED
   * @throws {InsufficientBalanceError} If driver has insufficient balance
   * @throws {WalletNotFoundError} If wallets don't exist
   */
  async settleOrder(request: SettleOrderRequest): Promise<SettleOrderResponse> {
    const { orderId, driverId, platformFeeAmount, settledBy, settledByRole, metadata } = request;

    // Validate platform fee
    validateAmount(platformFeeAmount);

    const timestamp = getCurrentTimestamp();
    const txnId = generateTxnId();

    // 1. Get hold record
    const hold = await this.getHold(orderId);
    if ((hold as any).financialSchemaVersion !== undefined) throw new InvalidHoldStateError('FINANCIAL_HOLD_REQUIRES_ORDER_SETTLEMENT');
    
    if (hold.status !== 'CAPTURED') {
      throw new InvalidHoldStateError(
        `Cannot settle hold in status: ${hold.status}. Only CAPTURED holds can be settled.`
      );
    }

    if (hold.driverId !== driverId) {
      throw new HoldNotFoundError(`Hold ${orderId} not found for driver ${driverId}`);
    }

    // Ensure capturedAmount exists
    if (!hold.capturedAmount) {
      throw new SettlementError(`Hold ${orderId} has no captured amount`);
    }

    // Validate platform fee doesn't exceed captured amount
    if (platformFeeAmount > hold.capturedAmount) {
      throw new SettlementError(
        `Platform fee ${formatAmount(platformFeeAmount)} cannot exceed captured amount ${formatAmount(hold.capturedAmount)}`
      );
    }

    // 2. Get driver and platform wallets
    const driverWalletId = hold.walletId;
    const platformWalletId = getPlatformWalletId();

    const [driverWallet, platformWallet] = await Promise.all([
      this.getWallet(driverWalletId),
      this.getWallet(platformWalletId)
    ]);

    // 3. Check driver has sufficient balance
    if (driverWallet.availableBalance < platformFeeAmount) {
      throw new InsufficientBalanceError(
        driverWallet.availableBalance,
        platformFeeAmount
      );
    }

    // 4. Prepare settlement record
    const settlement: Settlement = {
      settlementId: `SETTLEMENT#${orderId}`,
      sk: 'META',
      orderId,
      holdId: hold.holdId,
      driverId,
      driverWalletId,
      platformWalletId,
      capturedAmount: hold.capturedAmount,
      platformFeeAmount,
      driverNetAmount: hold.capturedAmount - platformFeeAmount,
      transactionId: txnId,
      status: 'COMPLETED',
      settledAt: timestamp,
      settledBy,
      settledByRole,
      metadata,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    // 5. Prepare ledger entries
    const datePartition = generateDatePartition();
    const ledgerSKDriver = generateLedgerSK(timestamp, 'SETTLEMENT_FEE');
    const ledgerSKPlatform = generateLedgerSK(timestamp, 'SETTLEMENT_FEE');

    const driverLedger: LedgerEntry = {
      walletId: driverWalletId,
      sk: ledgerSKDriver,
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
        settlementId: settlement.settlementId,
        orderId,
        capturedAmount: hold.capturedAmount,
        driverNetAmount: settlement.driverNetAmount
      }
    };

    const platformLedger: LedgerEntry = {
      walletId: platformWalletId,
      sk: ledgerSKPlatform,
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
        settlementId: settlement.settlementId,
        orderId,
        driverId,
        capturedAmount: hold.capturedAmount
      }
    };

    // 6. Prepare audit log
    const auditLog: AuditLog = {
      logId: `AUDIT#${txnId}`,
      sk: `ts#${timestamp}`,
      datePartition,
      action: 'SETTLE_ORDER',
      entityType: 'SETTLEMENT',
      entityId: settlement.settlementId,
      performedBy: settledBy,
      performedByRole: settledByRole,
      timestamp,
      details: {
        orderId,
        driverId,
        capturedAmount: hold.capturedAmount,
        platformFeeAmount,
        driverNetAmount: settlement.driverNetAmount,
        transactionId: txnId
      },
      metadata
    };

    // 7. Execute atomic transaction
    const transactParams: any = {
      TransactItems: [
        // Update driver wallet
        {
          Update: {
            TableName: TABLES.WALLETS,
            Key: { walletId: driverWalletId, sk: 'META' },
            UpdateExpression: 'SET availableBalance = availableBalance - :fee, #version = #version + :inc, updatedAt = :now',
            ConditionExpression: 'attribute_exists(walletId) AND #version = :currentVersion AND availableBalance >= :fee',
            ExpressionAttributeNames: {
              '#version': 'version'
            },
            ExpressionAttributeValues: {
              ':fee': platformFeeAmount,
              ':inc': 1,
              ':now': timestamp,
              ':currentVersion': driverWallet.version
            }
          }
        },
        // Update platform wallet
        {
          Update: {
            TableName: TABLES.WALLETS,
            Key: { walletId: platformWalletId, sk: 'META' },
            UpdateExpression: 'SET availableBalance = availableBalance + :fee, #version = #version + :inc, updatedAt = :now',
            ConditionExpression: 'attribute_exists(walletId) AND #version = :currentVersion',
            ExpressionAttributeNames: {
              '#version': 'version'
            },
            ExpressionAttributeValues: {
              ':fee': platformFeeAmount,
              ':inc': 1,
              ':now': timestamp,
              ':currentVersion': platformWallet.version
            }
          }
        },
        // Update hold status to SETTLED
        {
          Update: {
            TableName: TABLES.HOLDS,
            Key: { orderId, sk: 'META' },
            UpdateExpression: 'SET #status = :settled, settledAt = :now, updatedAt = :now',
            ConditionExpression: 'attribute_exists(orderId) AND #status = :captured',
            ExpressionAttributeNames: {
              '#status': 'status'
            },
            ExpressionAttributeValues: {
              ':settled': 'SETTLED',
              ':captured': 'CAPTURED',
              ':now': timestamp
            }
          }
        },
        // Create settlement record
        {
          Put: {
            TableName: TABLES.HOLDS, // Reuse holds table for settlements
            Item: settlement,
            ConditionExpression: 'attribute_not_exists(settlementId)'
          }
        },
        // Driver ledger entry
        {
          Put: {
            TableName: TABLES.LEDGER,
            Item: driverLedger
          }
        },
        // Platform ledger entry
        {
          Put: {
            TableName: TABLES.LEDGER,
            Item: platformLedger
          }
        },
        // Audit log
        {
          Put: {
            TableName: TABLES.AUDIT_LOG,
            Item: auditLog
          }
        }
      ]
    };

    try {
      await this.client.send(new TransactWriteCommand(transactParams));
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons || [];
        if (reasons.some((r: any) => r.Code === 'ConditionalCheckFailed')) {
          throw new SettlementError('Settlement failed: concurrent modification or invalid state');
        }
      }
      throw new SettlementError(`Failed to settle order: ${error.message}`);
    }

    return {
      settlementId: settlement.settlementId,
      orderId,
      transactionId: txnId,
      capturedAmount: hold.capturedAmount,
      platformFeeAmount,
      driverNetAmount: settlement.driverNetAmount,
      driverWalletBalance: driverWallet.availableBalance - platformFeeAmount,
      platformWalletBalance: platformWallet.availableBalance + platformFeeAmount,
      settledAt: timestamp
    };
  }

  /**
   * Get settlement details by order ID
   */
  async getSettlement(orderId: string): Promise<Settlement> {
    const settlementId = `SETTLEMENT#${orderId}`;
    
    const params = {
      TableName: TABLES.HOLDS,
      Key: { settlementId, sk: 'META' }
    };

    const result = await this.client.send(new GetCommand(params));

    if (!result.Item) {
      throw new HoldNotFoundError(`Settlement not found for order ${orderId}`);
    }

    return result.Item as Settlement;
  }

  /**
   * Get all settlements for a driver
   */
  async getDriverSettlements(driverId: string): Promise<GetSettlementsResponse> {
    const params = {
      TableName: TABLES.HOLDS,
      IndexName: 'DriverIdIndex', // Assumes GSI exists
      KeyConditionExpression: 'driverId = :driverId',
      FilterExpression: 'begins_with(settlementId, :prefix)',
      ExpressionAttributeValues: {
        ':driverId': driverId,
        ':prefix': 'SETTLEMENT#'
      }
    };

    const result = await this.client.send(new QueryCommand(params));

    const settlements = result.Items?.map(item => item as Settlement) || [];

    return {
      settlements,
      count: settlements.length
    };
  }

  /**
   * Helper: Get hold record
   */
  private async getHold(orderId: string): Promise<Hold> {
    const params = {
      TableName: TABLES.HOLDS,
      Key: { orderId, sk: 'META' }
    };

    const result = await this.client.send(new GetCommand(params));

    if (!result.Item) {
      throw new HoldNotFoundError(`Hold not found for order ${orderId}`);
    }

    return result.Item as Hold;
  }

  /**
   * Helper: Get wallet record
   */
  private async getWallet(walletId: string): Promise<Wallet> {
    const params = {
      TableName: TABLES.WALLETS,
      Key: { walletId, sk: 'META' }
    };

    const result = await this.client.send(new GetCommand(params));

    if (!result.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${walletId}`);
    }

    return result.Item as Wallet;
  }
}
