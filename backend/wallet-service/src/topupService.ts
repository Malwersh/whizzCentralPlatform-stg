import {financialStaff,staffGuard,approvalAmount} from './staffAccess';
import { walletNotification } from './walletNotifications';
import { docClient, TABLES, GetCommand, QueryCommand, TransactWriteCommand } from './db';
import {
  TopupRequest,
  Wallet,
  LedgerEntry,
  CreateTopupRequestRequest,
  CreateTopupRequestResponse,
  ApproveTopupRequest,
  ApproveTopupResponse,
  RejectTopupRequest,
  RejectTopupResponse,
  GetTopupRequestsResponse,
  WalletNotFoundError,
  TopupNotFoundError,
  InvalidTopupStateError,
} from './types';
import {
  generateTopupId,
  generateTxnId,
  generateLedgerSK,
  getCurrentTimestamp,
  validateAmount,
  generateDatePartition,
  getPlatformWalletId,
} from './utils';
import { fundingError, referenceHash } from './fundingService';

/**
 * Topup Service - Add Balance to Wallets
 * 
 * Workflow:
 * 1. Driver creates topup request (with proof/evidence)
 * 2. Admin/Agent reviews and approves/rejects
 * 3. If approved, balance is added to wallet
 * 4. Platform wallet is credited (cash received)
 * 
 * Handles:
 * - Creating topup requests
 * - Approving requests (adds balance)
 * - Rejecting requests
 * - Querying requests
 */
export class TopupService {
  /**
   * Create a topup request
   * 
   * Driver initiates request with amount and evidence
   */
  async createTopupRequest(
    request: CreateTopupRequestRequest
  ): Promise<CreateTopupRequestResponse> {
    const { driverId, amount, method, evidenceRef, note } = request;
    if (!request.idempotencyKey || !/^[a-zA-Z0-9-]{16,80}$/.test(request.idempotencyKey)) throw fundingError("مفتاح الطلب مطلوب");
    if (method !== "MANUAL_VERIFICATION" || amount < 25000 || !Number.isSafeInteger(amount) || !evidenceRef || !request.transferReference) throw fundingError("الحد الأدنى 25000 دينار والوصل ومرجع التحويل مطلوبان");

    // Validate
    validateAmount(amount);

    // Evidence required for amounts > 50,000 IQD
    if (amount > 50000 && !evidenceRef) {
      throw new Error('Evidence (evidenceRef) is required for topup amounts greater than 50,000 IQD');
    }

    const topupId = generateTopupId();
    const walletId = `WALLET#DRIVER#${driverId}`;
    const timestamp = getCurrentTimestamp();
    const idempotencyKey = `TOPUP_CREATE#${driverId}#${request.idempotencyKey}`;

    // Check idempotency
    const existingKey = await docClient.send(
      new GetCommand({
        TableName: TABLES.IDEMPOTENCY_KEYS,
        Key: { idempotencyKey, sk: 'META' },
      })
    );

    if (existingKey.Item) {
      console.log('Duplicate topup request detected, returning existing result');
      const saved = existingKey.Item.result as CreateTopupRequestResponse;
      if (saved.topupRequest.amount !== amount || saved.topupRequest.evidenceRef !== evidenceRef || saved.topupRequest.transferReference !== request.transferReference) throw fundingError('مفتاح الطلب مستخدم ببيانات مختلفة','IDEMPOTENCY_CONFLICT',409);
      return saved;
    }

    // Check wallet exists
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId, sk: 'META' },
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found for driver: ${driverId}`);
    }
    if (walletResult.Item.status !== 'ACTIVE' || walletResult.Item.deletionRequestId) throw fundingError('هذه المحفظة غير متاحة للشحن','ACCOUNT_CLOSING',409);

    // Create topup request
    const topupRequest: TopupRequest = {
      topupId,
      sk: 'META',
      driverId,
      walletId,
      amount,
      method: method || 'CASH_AGENT',
      status: 'PENDING',
      evidenceRef,
      transferReference: request.transferReference,
      fundingSnapshot: request.fundingSnapshot,
      note,
      createdAt: timestamp,
      updatedAt: timestamp,
      createdById: driverId,
      createdByRole: 'DRIVER',
    };

    // Prepare response
    const response: CreateTopupRequestResponse = {
      success: true,
      topupRequest,
      message: `Topup request created successfully. Request ID: ${topupId}`,
    };

    // Save to database
    try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          {Update: {TableName: TABLES.WALLETS, Key: {walletId, sk:'META'}, UpdateExpression:'SET #v = #v + :one', ConditionExpression:'#s = :active AND attribute_not_exists(deletionRequestId) AND #v = :v', ExpressionAttributeNames:{'#s':'status','#v':'version'}, ExpressionAttributeValues:{':active':'ACTIVE',':v':walletResult.Item.version,':one':1}}},
          ...(process.env.ACCOUNT_DELETION_TABLE && /^receipts\/[A-Za-z0-9_-]+\/[a-f0-9-]{36}\.(jpg|png)$/.test(evidenceRef!) ? [{Delete:{TableName:process.env.ACCOUNT_DELETION_TABLE,Key:{pk:`ACCOUNT_OPERATION#DRIVER#${driverId}`,sk:'FUNDING_RECEIPT#'+evidenceRef!.split('/').at(-1)!.split('.')[0]},ConditionExpression:'attribute_not_exists(pk) OR (assetKey = :asset AND subjectId = :sub)',ExpressionAttributeValues:{':asset':evidenceRef!,':sub':driverId}}}] : []),
          ...[referenceHash(request.transferReference!), referenceHash(evidenceRef!)].map((hash, index) => ({Put: {TableName: TABLES.IDEMPOTENCY_KEYS, Item: {idempotencyKey: `FUNDING_${index === 0 ? 'REFERENCE' : 'RECEIPT'}#${hash}`, sk:'META', topupId, driverId}, ConditionExpression: 'attribute_not_exists(idempotencyKey)'}})),
          {
            Put: {
              TableName: TABLES.TOPUP_REQUESTS,
              Item: topupRequest,
              ConditionExpression: 'attribute_not_exists(topupId)',
            },
          },
          // Idempotency key
          {
            Put: {
              TableName: TABLES.IDEMPOTENCY_KEYS,
              Item: {
                idempotencyKey,
                sk: 'META',
                processedAt: timestamp,
                result: response,
                ttl: Math.floor(Date.now() / 1000) + 86400, // 24 hours
              },
              ConditionExpression: 'attribute_not_exists(idempotencyKey)',
            },
          },
          // Audit log
          {
            Put: {
              TableName: TABLES.AUDIT_LOG,
              Item: {
                logId: `LOG#${topupId}`,
                datePartition: generateDatePartition(new Date(timestamp)),
                sk: timestamp,
                action: 'TOPUP_REQUEST_CREATED',
                walletId,
                amount,
                topupId,
                timestamp,
                metadata: { driverId, method, evidenceRef },
              },
            },
          },
        ],
      })
    );
    } catch (error: any) {
      if (error.name !== 'TransactionCanceledException') throw error;
      const retry = await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:{idempotencyKey,sk:'META'},ConsistentRead:true}));
      const saved = retry.Item?.result as CreateTopupRequestResponse | undefined;
      if (saved && saved.topupRequest.amount === amount && saved.topupRequest.evidenceRef === evidenceRef && saved.topupRequest.transferReference === request.transferReference) return saved;
      throw fundingError('التحويل أو الوصل مستخدم في طلب آخر، أو تكرر الطلب ببيانات مختلفة', 'DUPLICATE_FUNDING',409);
    }

    return response;
  }

  /**
   * Approve a topup request and add balance to wallet
   * 
   * Admin approves and balance is added atomically
   */
  async approveTopupRequest(
    request: ApproveTopupRequest
  ): Promise<ApproveTopupResponse> {
    const { topupId, approvedById, approvedByRole, note } = request;
    const staff=await financialStaff(approvedById,'finance.approve');
    const timestamp = getCurrentTimestamp();
    const idempotencyKey = `TOPUP_APPROVE#${topupId}`;

    // Check idempotency
    const existingKey = await docClient.send(
      new GetCommand({
        TableName: TABLES.IDEMPOTENCY_KEYS,
        Key: { idempotencyKey, sk: 'META' },
        ConsistentRead: true,
      })
    );

    if (existingKey.Item) {
      console.log('Duplicate approval detected, returning existing result');
      return existingKey.Item.result as ApproveTopupResponse;
    }

    // Get topup request
    const topupResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.TOPUP_REQUESTS,
        Key: { topupId, sk: 'META' },
      })
    );

    if (!topupResult.Item) {
      throw new TopupNotFoundError(`Topup request not found: ${topupId}`);
    }

    const topup = topupResult.Item as TopupRequest;

    // Check status
    if (topup.status !== 'PENDING') {
      throw new InvalidTopupStateError(
        `Topup request cannot be approved. Current status: ${topup.status}`
      );
    }

    // SECURITY: Maker-Checker - Approver must be different from creator
    if (topup.createdById === approvedById) {
      throw new Error('Cannot approve your own topup request (Maker-Checker policy)');
    }

    // SECURITY: Check daily approval limit (500,000 IQD per admin per day)
    const dailyTotal = await this.getAdminDailyApprovals(approvedById);
    if (dailyTotal + topup.amount > 500000) {
      throw new Error(
        `Daily approval limit exceeded. Current: ${dailyTotal} IQD, Request: ${topup.amount} IQD, Limit: 500,000 IQD`
      );
    }

    // SECURITY: Evidence check for large amounts
    if (topup.amount > 50000 && !topup.evidenceRef) {
      throw new Error('Evidence is required for amounts greater than 50,000 IQD');
    }

    // Get wallet
    const walletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId: topup.walletId, sk: 'META' },
      })
    );

    if (!walletResult.Item) {
      throw new WalletNotFoundError(`Wallet not found: ${topup.walletId}`);
    }

    const wallet = walletResult.Item as Wallet;
    if (wallet.status !== 'ACTIVE' || walletResult.Item.deletionRequestId) throw fundingError('هذه المحفظة غير متاحة للشحن','ACCOUNT_CLOSING',409);

    // Get platform wallet
    const platformWalletId = getPlatformWalletId();
    const platformWalletResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: { walletId: platformWalletId, sk: 'META' },
      })
    );

    if (!platformWalletResult.Item) {
      throw new WalletNotFoundError('Platform wallet not found');
    }

    const platformWallet = platformWalletResult.Item as Wallet;

    // Prepare transaction
    const txnId = generateTxnId();

    // Ledger entries for driver wallet (credit)
    const driverCreditEntry: LedgerEntry = {
      walletId: topup.walletId,
      sk: generateLedgerSK(timestamp, txnId),
      txnId,
      transactionId: txnId,
      type: 'TOPUP',
      amount: topup.amount, // Credit to available
      balance: wallet.availableBalance + topup.amount,
      relatedEntityId: topupId,
      relatedEntityType: 'TOPUP',
      description: `Topup approved: ${topup.amount} IQD`,
      metadata: { topupId, method: topup.method, approvedById },
      timestamp,
      createdAt: timestamp,
    };

    // Ledger entries for platform wallet (debit - cash received)
    const platformDebitEntry: LedgerEntry = {
      walletId: platformWalletId,
      sk: generateLedgerSK(timestamp, txnId),
      txnId,
      transactionId: txnId,
      type: 'TOPUP',
      amount: topup.amount, // Debit (cash received)
      balance: platformWallet.availableBalance + topup.amount,
      relatedEntityId: topupId,
      relatedEntityType: 'TOPUP',
      description: `Cash received from topup`,
      metadata: { topupId, driverId: topup.driverId, method: topup.method },
      timestamp,
      createdAt: timestamp,
    };

    // Prepare response
    const response: ApproveTopupResponse = {
      success: true,
      topupId,
      message: `Topup approved successfully. ${topup.amount} IQD added to wallet.`,
      newBalance: wallet.availableBalance + topup.amount,
    };

    approvalAmount(staff,topup.amount);
    // Atomic transaction
    try {
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          ...(staff?[staffGuard(staff)]:[]),
          walletNotification(topup, 'APPROVED', timestamp),
          { Update: {
            TableName: TABLES.IDEMPOTENCY_KEYS,
            Key: { idempotencyKey: `FINANCE_DAILY#${approvedById}#${timestamp.slice(0,10)}`, sk:'META' },
            UpdateExpression: 'SET #ttl = :expiry ADD approvedAmount :amount',
            ConditionExpression: 'attribute_not_exists(approvedAmount) OR approvedAmount <= :remaining',
            ExpressionAttributeNames: {'#ttl':'ttl'},
            ExpressionAttributeValues: {':amount':topup.amount,':remaining':500000-topup.amount,':expiry':Math.floor(Date.now()/1000)+172800}
          } },

          // Update topup status
          {
            Update: {
              TableName: TABLES.TOPUP_REQUESTS,
              Key: { topupId, sk: 'META' },
              UpdateExpression:
                'SET #status = :approved, updatedAt = :timestamp, ' +
                'approvedAt = :timestamp, approvedById = :approvedById, ' +
                'approvedByRole = :approvedByRole, approvalNote = :note',
              ConditionExpression: '#status = :pending AND createdById <> :approvedById',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':approved': 'APPROVED',
                ':pending': 'PENDING',
                ':timestamp': timestamp,
                ':approvedById': approvedById,
                ':approvedByRole': approvedByRole,
                ':note': note || 'Approved',
              },
            },
          },
          // Idempotency key
          {
            Put: {
              TableName: TABLES.IDEMPOTENCY_KEYS,
              Item: {
                idempotencyKey,
                sk: 'META',
                processedAt: timestamp,
                result: response,
                ttl: Math.floor(Date.now() / 1000) + 86400, // 24 hours
              },
              ConditionExpression: 'attribute_not_exists(idempotencyKey)',
            },
          },
          // Update driver wallet balance
          {
            Update: {
              TableName: TABLES.WALLETS,
              Key: { walletId: topup.walletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ConditionExpression: '#version = :expectedVersion AND #s = :active AND attribute_not_exists(deletionRequestId)',
              ExpressionAttributeNames: {
                '#version': 'version',
                '#s': 'status',
              },
              ExpressionAttributeValues: {
                ':amount': topup.amount,
                ':timestamp': timestamp,
                ':one': 1,
                ':expectedVersion': wallet.version,
                ':active': 'ACTIVE',
              },
            },
          },
          // Update platform wallet balance
          {
            Update: {
              TableName: TABLES.WALLETS,
              Key: { walletId: platformWalletId, sk: 'META' },
              UpdateExpression:
                'SET availableBalance = availableBalance + :amount, ' +
                'updatedAt = :timestamp, ' +
                '#version = #version + :one',
              ConditionExpression: '#version = :expectedVersion',
              ExpressionAttributeNames: {
                '#version': 'version',
              },
              ExpressionAttributeValues: {
                ':amount': topup.amount,
                ':timestamp': timestamp,
                ':one': 1,
                ':expectedVersion': platformWallet.version,
              },
            },
          },
          // Record driver wallet credit
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: driverCreditEntry,
            },
          },
          // Record platform wallet debit
          {
            Put: {
              TableName: TABLES.LEDGER,
              Item: platformDebitEntry,
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
                action: 'TOPUP_APPROVED',
                walletId: topup.walletId,
                amount: topup.amount,
                topupId,
                timestamp,
                metadata: { driverId: topup.driverId, approvedById, approvedByRole },
              },
            },
          },
        ],
      })
    );

    } catch (error: any) {
      if (error.name !== 'TransactionCanceledException') throw error;
      const retry = await docClient.send(new GetCommand({TableName: TABLES.IDEMPOTENCY_KEYS, Key:{idempotencyKey,sk:'META'}, ConsistentRead:true}));
      if (retry.Item?.result) return retry.Item.result as ApproveTopupResponse;
      throw fundingError('تغير الرصيد أو حالة الطلب، أو بلغ الاعتماد الحد اليومي؛ حدث الصفحة وأعد المحاولة', 'APPROVAL_CONFLICT', 409);
    }
    return response;
  }

  /**
   * Get admin's total approved amount for today (for daily limit check)
   */
  private async getAdminDailyApprovals(adminId: string): Promise<number> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await docClient.send(new GetCommand({
      TableName: TABLES.IDEMPOTENCY_KEYS,
      Key: { idempotencyKey: `FINANCE_DAILY#${adminId}#${today}`, sk: 'META' },
      ConsistentRead: true,
    }));
    return result.Item?.approvedAmount || 0;
  }

  /**
   * Reject a topup request
   * 
   * Admin rejects the request with reason
   */
  async rejectTopupRequest(
    request: RejectTopupRequest
  ): Promise<RejectTopupResponse> {
    const { topupId, rejectedById, rejectedByRole, rejectionReason } = request;
    const timestamp = getCurrentTimestamp();

    // Get topup request
    const topupResult = await docClient.send(
      new GetCommand({
        TableName: TABLES.TOPUP_REQUESTS,
        Key: { topupId, sk: 'META' },
      })
    );

    if (!topupResult.Item) {
      throw new TopupNotFoundError(`Topup request not found: ${topupId}`);
    }

    const topup = topupResult.Item as TopupRequest;

    // Check status
    if (topup.status !== 'PENDING') {
      throw new InvalidTopupStateError(
        `Topup request cannot be rejected. Current status: ${topup.status}`
      );
    }

    // Update status
    await docClient.send(
      new TransactWriteCommand({
        TransactItems: [
          walletNotification(topup, 'REJECTED', timestamp),
          {
            Update: {
              TableName: TABLES.TOPUP_REQUESTS,
              Key: { topupId, sk: 'META' },
              UpdateExpression:
                'SET #status = :rejected, updatedAt = :timestamp, ' +
                'rejectedAt = :timestamp, rejectedById = :rejectedById, ' +
                'rejectedByRole = :rejectedByRole, rejectionReason = :reason',
              ConditionExpression: '#status = :pending',
              ExpressionAttributeNames: {
                '#status': 'status',
              },
              ExpressionAttributeValues: {
                ':rejected': 'REJECTED',
                ':pending': 'PENDING',
                ':timestamp': timestamp,
                ':rejectedById': rejectedById,
                ':rejectedByRole': rejectedByRole,
                ':reason': rejectionReason,
              },
            },
          },
          // Audit log
          {
            Put: {
              TableName: TABLES.AUDIT_LOG,
              Item: {
                logId: `LOG#${topupId}#reject`,
                datePartition: generateDatePartition(new Date(timestamp)),
                sk: timestamp,
                action: 'TOPUP_REJECTED',
                walletId: topup.walletId,
                amount: topup.amount,
                topupId,
                timestamp,
                metadata: { driverId: topup.driverId, rejectedById, rejectionReason },
              },
            },
          },
        ],
      })
    );

    return {
      success: true,
      topupId,
      message: 'Topup request rejected.',
    };
  }

  /**
   * Get topup requests by status
   * 
   * Admin can view all pending requests
   */
  async getTopupRequests(status?: string): Promise<GetTopupRequestsResponse> {
    const params: any = {
      TableName: TABLES.TOPUP_REQUESTS,
      IndexName: 'byStatus',
      KeyConditionExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':status': status || 'PENDING',
      },
      ScanIndexForward: false, // Most recent first
      Limit: 100,
    };

    const result = await docClient.send(new QueryCommand(params));

    const requests = (result.Items || []) as TopupRequest[];

    return {
      success: true,
      requests,
      count: requests.length,
    };
  }

  /**
   * Get driver's topup requests
   */
  async getMyTopupRequests(driverId: string): Promise<GetTopupRequestsResponse> {
    const params: any = {
      TableName: TABLES.TOPUP_REQUESTS,
      IndexName: 'byDriver',
      KeyConditionExpression: 'driverId = :driverId',
      ExpressionAttributeValues: {
        ':driverId': driverId,
      },
      ScanIndexForward: false, // Most recent first
      Limit: 50,
    };

    const result = await docClient.send(new QueryCommand(params));

    const requests = (result.Items || []) as TopupRequest[];

    return {
      success: true,
      requests,
      count: requests.length,
    };
  }
}
