import { sandboxConfig, sandboxOverview, createSandboxPayment, checkSandboxPayment, sandboxSettings, saveSandboxSettings, reconcileSandboxPayments, sandboxNotification } from './sandboxPayments';
import { docClient, QueryCommand, ScanCommand, TABLES } from './db';
import { getFundingConfig, saveFundingConfig, receiptUpload, receiptView, validateReceipt, fundingError } from './fundingService';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { WalletService } from './walletService';
import { HoldService } from './holdService';
import { TopupService } from './topupService';
import { SettlementService } from './settlementService';
import {
  buildSuccessResponse,
  buildErrorResponse,
  parseBody,
  generateDriverWalletId,
} from './utils';
import { WalletError, WalletNotFoundError } from './types';

const walletService = new WalletService();
const holdService = new HoldService();
const topupService = new TopupService();
const settlementService = new SettlementService();

/**
 * Main Lambda Handler for Wallet Service
 * 
 * Routes:
 * - GET /wallet/me - Get driver's wallet
 * - GET /wallet/me/transactions - Get transaction history
 * - POST /wallet/create - Create wallet (internal use)
 * - GET /wallet/{walletId} - Get any wallet (admin only)
 */
export async function handler(
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> {
  if ((event as any).source === 'aws.events') {
    await reconcileSandboxPayments();
    return buildSuccessResponse({reconciled:true});
  }
  console.log('Wallet Service Request:', {
    path: event.path,
    method: event.httpMethod,
    resource: event.resource,
  });

  try {
    const path = event.path;
    const method = event.httpMethod;

    if(path === '/wallet/funding/sandbox/notification' && method === 'POST') {
      if((event.body || '').length>8192) return buildErrorResponse(413,'PAYLOAD_TOO_LARGE','Payload too large');
      return buildSuccessResponse(await sandboxNotification(parseBody(event.body)));
    }
    // Health check
    if (path === '/health' && method === 'GET') {
      return buildSuccessResponse({ status: 'healthy', service: 'wallet' });
    }

    // Extract authentication info from Lambda authorizer context
    const authorizer = event.requestContext.authorizer;
    console.log('Authorizer context:', JSON.stringify(authorizer));
    
    // Get user ID from authorizer context
    const driverId = authorizer?.driverId;
    const adminId = authorizer?.adminId;
    const serviceId = authorizer?.serviceId;
    
    // Log authenticated actor for audit
    if (driverId) {
      console.log('Authenticated as: driver', driverId);
    } else if (adminId) {
      console.log('Authenticated as: admin', adminId);
    } else if (serviceId) {
      console.log('Authenticated as: service', serviceId);
    } else {
      console.log('Authenticated as: anonymous');
    }

    const finance = adminId && (authorizer?.financeManager === true || authorizer?.financeManager === 'true');
    const financialRoute = path.startsWith('/wallet/funding/admin') || path === '/wallet/topup/requests' || /\/wallet\/topup\/[^/]+\/(approve|reject)$/.test(path);
    if (financialRoute && !finance) return buildErrorResponse(403, 'FINANCE_MANAGER_REQUIRED', 'صلاحية المدير المالي مطلوبة');
    if (path.startsWith('/wallet/funding/') && !driverId && !adminId) return buildErrorResponse(401,'UNAUTHORIZED','يرجى تسجيل الدخول');
    if (path === '/wallet/funding/admin/transactions' && method === 'GET') {
      const walletId = event.queryStringParameters?.walletId || '';
      const cursor = event.queryStringParameters?.cursor;
      if (!/^WALLET#(DRIVER#[a-f0-9-]{36}|PLATFORM)$/.test(walletId)) return buildErrorResponse(400, 'INVALID_WALLET', 'المحفظة غير صالحة');
      if (cursor) {
        try {
          if (cursor.length > 2048) throw new Error('cursor');
          const key = JSON.parse(cursor);
          if (key.walletId !== walletId || typeof key.sk !== 'string' || !key.sk.startsWith('ts#') || Object.keys(key).length !== 2) throw new Error('cursor');
        } catch (_) { return buildErrorResponse(400, 'INVALID_CURSOR', 'مؤشر السجل غير صالح'); }
      }
      return buildSuccessResponse(await walletService.getTransactions(walletId, 50, cursor));
    }
    if (path === '/wallet/funding/admin/wallets' && method === 'GET') {
      const cursor = event.queryStringParameters?.cursor;
      let start;
      if (cursor) {
        try {
          if (cursor.length > 1024) throw new Error('cursor');
          start = JSON.parse(Buffer.from(cursor, 'base64url').toString());
          if (!start || typeof start.walletId !== 'string' || start.sk !== 'META' || Object.keys(start).length !== 2) throw new Error('cursor');
        } catch (_) { return buildErrorResponse(400, 'INVALID_CURSOR', 'مؤشر الصفحة غير صالح'); }
      }
      const result = await docClient.send(new ScanCommand({
        TableName: TABLES.WALLETS, Limit: 50, ExclusiveStartKey: start,
        FilterExpression: 'sk = :meta', ExpressionAttributeValues: { ':meta': 'META' },
        ProjectionExpression: 'walletId, sk, ownerId, ownerType, currency, #s, availableBalance, lockedBalance, updatedAt',
        ExpressionAttributeNames: { '#s': 'status' }
      }));
      return buildSuccessResponse({ wallets: result.Items || [], nextCursor: result.LastEvaluatedKey ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url') : null });
    }
    if (path === '/wallet/funding/config' && method === 'GET') return buildSuccessResponse(await getFundingConfig());
    if (path === '/wallet/funding/admin/config' && method === 'PUT') return buildSuccessResponse(await saveFundingConfig(parseBody(event.body), adminId));
    if (path === '/wallet/funding/receipt' && method === 'POST') {
      if (!driverId) return buildErrorResponse(403,'DRIVER_REQUIRED','حساب سائق مطلوب');
      return buildSuccessResponse(await receiptUpload(driverId,parseBody(event.body)));
    }
    if (path === '/wallet/funding/admin/receipt' && method === 'POST') return buildSuccessResponse(await receiptView(parseBody(event.body)?.key || ''));
    if (path.startsWith('/wallet/funding/sandbox')) {
      if (!driverId) return buildErrorResponse(403,'DRIVER_REQUIRED','حساب سائق مطلوب');
      if (path === '/wallet/funding/sandbox/config' && method === 'GET') return buildSuccessResponse(await sandboxConfig(driverId));
      if (path === '/wallet/funding/sandbox' && method === 'GET') return buildSuccessResponse(await sandboxOverview(driverId));
      if (path === '/wallet/funding/sandbox/payment' && method === 'POST') return buildSuccessResponse(await createSandboxPayment(driverId,parseBody(event.body)));
      if (path === '/wallet/funding/sandbox/check' && method === 'POST') return buildSuccessResponse(await checkSandboxPayment(driverId,parseBody(event.body)?.requestId));
      return buildErrorResponse(404,'NOT_FOUND','Route not found');
    }
    if (path === '/wallet/funding/admin/sandbox' && method === 'GET') return buildSuccessResponse(event.queryStringParameters?.driverId ? await sandboxOverview(event.queryStringParameters.driverId) : await sandboxSettings());
    if (path === '/wallet/funding/admin/sandbox' && method === 'PUT') return buildSuccessResponse(await saveSandboxSettings(parseBody(event.body),adminId));
    if (path === '/wallet/funding/payment' && method === 'POST') return buildErrorResponse(409,'PAYMENT_PROVIDER_NOT_CONFIGURED','طريقة الدفع الحقيقي غير مفعلة بعد');

    if (path === '/wallet/me/notifications' && method === 'GET') {
      if (!driverId) return buildErrorResponse(401,'UNAUTHORIZED','Driver authentication required');
      const result = await docClient.send(new QueryCommand({TableName:process.env.WALLET_NOTIFICATIONS_TABLE,IndexName:'ByDriver',KeyConditionExpression:'driverId = :driver',ExpressionAttributeValues:{':driver':driverId},ScanIndexForward:false,Limit:50}));
      return buildSuccessResponse({notifications:(result.Items || []).map(item=>({eventId:item.eventId,type:item.type,title:item.title,body:item.body,createdAt:item.createdAt,topupId:item.topupId,amount:item.amount}))});
    }
    // Route handlers
    if (path === '/wallet/me' && method === 'GET') {
      if (!driverId) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
      }
      return await getMyWallet(driverId);
    }

    if (path === '/wallet/me/transactions' && method === 'GET') {
      if (!driverId) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
      }
      return await getMyTransactions(driverId, event.queryStringParameters);
    }

    if (path === '/wallet/create' && method === 'POST') {
      // Wallet creation endpoint (called by Cognito trigger or service accounts)
      const triggerSecret = event.headers?.['x-trigger-secret'];
      const expectedSecret = process.env.WALLET_TRIGGER_SECRET || 'wallet-creation-trigger-secret-2025';
      
      // Allow if: service account OR valid trigger secret
      if (!serviceId && triggerSecret !== expectedSecret) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Only service accounts or Lambda triggers can create wallets');
      }
      return await createWallet(event.body);
    }

    // Platform wallet endpoints (must come before /wallet/{walletId})
    if (path === '/wallet/platform' && method === 'GET') {
      if (!finance && !serviceId) return buildErrorResponse(403, 'FORBIDDEN', 'صلاحية مالية مطلوبة');
      return await getPlatformWallet();
    }

    if (path === '/wallet/platform/create' && method === 'POST') {
      if (!finance && !serviceId) return buildErrorResponse(403, 'FORBIDDEN', 'صلاحية مالية مطلوبة');
      return await createPlatformWallet();
    }

    // Generic wallet endpoint (after specific routes)
    if (path.startsWith('/wallet/') && method === 'GET' && !path.includes('/hold') && !path.includes('/topup') && !path.includes('/settlement')) {
      // Defense in depth: the gateway authorizer is not the only ownership boundary.
      if (!finance) return buildErrorResponse(403, 'FINANCE_MANAGER_REQUIRED', 'صلاحية المدير المالي مطلوبة');
      const walletId = path.split('/')[2];
      return await getWallet(walletId);
    }

    // Hold endpoints
    if (path === '/wallet/hold/create' && method === 'POST') {
      // Service accounts can create holds
      if (!serviceId) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Service authentication required');
      }
      return await createHold(serviceId, event.body);
    }

    if (path.match(/^\/wallet\/hold\/[^/]+\/release$/) && method === 'POST') {
      if (!serviceId) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Service authentication required');
      }
      const holdId = path.split('/')[3];
      return await releaseHold(holdId, event.body);
    }

    if (path.match(/^\/wallet\/hold\/[^/]+\/capture$/) && method === 'POST') {
      if (!serviceId) {
        return buildErrorResponse(401, 'UNAUTHORIZED', 'Service authentication required');
      }
      const holdId = path.split('/')[3];
      return await captureHold(holdId, event.body);
    }

    if (path === '/wallet/holds/active' && method === 'GET') {
      return await getActiveHolds(driverId);
    }

    // Topup endpoints
    if (path === '/wallet/topup/request' && method === 'POST') {
      return await createTopupRequest(driverId, event.body);
    }

    if (path.match(/^\/wallet\/topup\/[^/]+\/approve$/) && method === 'POST') {
      const topupId = path.split('/')[3];
      return await approveTopupRequest(topupId, adminId, event.body);
    }

    if (path.match(/^\/wallet\/topup\/[^/]+\/reject$/) && method === 'POST') {
      const topupId = path.split('/')[3];
      return await rejectTopupRequest(topupId, adminId, event.body);
    }

    if (path === '/wallet/topup/requests' && method === 'GET') {
      return await getTopupRequests(event.queryStringParameters);
    }

    if (path === '/wallet/topup/my-requests' && method === 'GET') {
      return await getMyTopupRequests(driverId);
    }

    // Settlement endpoints
    if (path === '/wallet/settlement/settle' && method === 'POST') {
      return await settleOrder(event.body);
    }

    if (path.match(/^\/wallet\/settlement\/order\/[^/]+$/) && method === 'GET') {
      if (!serviceId && !finance) return buildErrorResponse(403, 'FORBIDDEN', 'صلاحية مالية مطلوبة');
      const orderId = path.split('/')[4];
      return await getSettlement(orderId);
    }

    if (path === '/wallet/settlement/driver' && method === 'GET') {
      return await getDriverSettlements(driverId);
    }

    return buildErrorResponse(404, 'NOT_FOUND', 'Route not found');
  } catch (error) {
    console.error('Handler Error:', error);

    if (error instanceof WalletError) {
      return buildErrorResponse(error.statusCode, error.code, error.message);
    }

    return buildErrorResponse(
      500,
      'INTERNAL_ERROR',
      'An unexpected error occurred'
    );
  }
}

/**
 * GET /wallet/me
 */
async function getMyWallet(
  driverId: string | null
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const walletId = generateDriverWalletId(driverId);
  let wallet;
  try {
    wallet = await walletService.getWallet(walletId);
  } catch (error) {
    // Root fix: if Cognito trigger was missed, provision on-demand for authenticated driver
    if (error instanceof WalletNotFoundError) {
      console.log('Wallet not found for driver - auto-provisioning...', {
        driverId,
        walletId,
      });

      await walletService.createWallet({ driverId });
      wallet = await walletService.getWallet(walletId);
    } else {
      throw error;
    }
  }

  return buildSuccessResponse(wallet);
}

/**
 * GET /wallet/me/transactions
 */
async function getMyTransactions(
  driverId: string | null,
  queryParams: any
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const walletId = generateDriverWalletId(driverId);
  const limit = queryParams?.limit ? parseInt(queryParams.limit) : 50;
  // Accept both `nextToken` and `lastEvaluatedKey` for frontend compatibility
  const pageToken = queryParams?.nextToken || queryParams?.lastEvaluatedKey || undefined;

  let transactions;
  try {
    transactions = await walletService.getTransactions(walletId, limit, pageToken);
  } catch (error) {
    // Root fix: if wallet doesn't exist yet, provision and return empty history
    if (error instanceof WalletNotFoundError) {
      console.log('Wallet not found for driver transactions - auto-provisioning...', {
        driverId,
        walletId,
      });

      await walletService.createWallet({ driverId });
      transactions = await walletService.getTransactions(walletId, limit, pageToken);
    } else {
      throw error;
    }
  }

  return buildSuccessResponse(transactions);
}

/**
 * POST /wallet/create
 * Service only - called by Cognito trigger or backend services
 */
async function createWallet(body: string | null): Promise<APIGatewayProxyResult> {
  const data = parseBody(body);

  if (!data.driverId) {
    return buildErrorResponse(400, 'INVALID_REQUEST', 'driverId is required');
  }

  console.log('Service creating wallet for driver:', data.driverId);

  try {
    const result = await walletService.createWallet({
      driverId: data.driverId,
      minRequiredBalance: data.minRequiredBalance || 25000,
    });

    return buildSuccessResponse(result, 201);
  } catch (error: any) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Wallet already exists - return success (idempotent)
      const walletId = generateDriverWalletId(data.driverId);
      const wallet = await walletService.getWallet(walletId);
      return buildSuccessResponse({
        walletId: wallet.walletId,
        availableBalance: wallet.availableBalance,
        lockedBalance: wallet.lockedBalance,
        status: wallet.status,
        message: 'Wallet already exists',
      }, 200);
    }
    throw error;
  }
}

/**
 * GET /wallet/{walletId}
 * Note: walletId here is actually the driverId from the path parameter
 */
async function getWallet(driverId: string): Promise<APIGatewayProxyResult> {
  const walletId = generateDriverWalletId(driverId);
  const wallet = await walletService.getWallet(walletId);
  return buildSuccessResponse(wallet);
}

/**
 * GET /wallet/platform
 */
async function getPlatformWallet(): Promise<APIGatewayProxyResult> {
  const wallet = await walletService.getPlatformWallet();
  return buildSuccessResponse(wallet);
}

/**
 * POST /wallet/platform/create
 */
async function createPlatformWallet(): Promise<APIGatewayProxyResult> {
  const result = await walletService.createPlatformWallet();
  return buildSuccessResponse(result, 201);
}
/**
 * POST /wallet/hold/create
 */
async function createHold(
  serviceId: string | null,
  body: string | null
): Promise<APIGatewayProxyResult> {
  if (!serviceId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Service authentication required');
  }

  const data = parseBody(body);

  // Accept either userId (convert to walletId) or walletId directly
  const userId = data.userId || data.driverId;
  const walletId = data.walletId || (userId ? generateDriverWalletId(userId) : null);

  if (!walletId || !data.amount || !data.orderId) {
    return buildErrorResponse(
      400,
      'INVALID_REQUEST',
      'userId/walletId, amount and orderId are required'
    );
  }

  console.log('Creating Hold for wallet:', walletId);
  console.log('Amount:', data.amount, 'IQD');
  console.log('Order ID:', data.orderId);

  const result = await holdService.createHold({
    walletId: walletId,
    amount: data.amount,
    orderId: data.orderId,
    reason: data.reason,
    metadata: data.metadata,
    assignmentAttempt: data.assignmentAttempt,
  });

  return buildSuccessResponse(result, 201);
}

/**
 * POST /wallet/hold/{holdId}/release
 */
async function releaseHold(
  holdId: string,
  body: string | null
): Promise<APIGatewayProxyResult> {
  const data = parseBody(body);

  const result = await holdService.releaseHold({
    holdId,
    reason: data?.reason,
  });

  return buildSuccessResponse(result);
}

/**
 * POST /wallet/hold/{holdId}/capture
 */
async function captureHold(
  holdId: string,
  body: string | null
): Promise<APIGatewayProxyResult> {
  const data = parseBody(body);

  const result = await holdService.captureHold({
    holdId,
    actualAmount: data?.actualAmount,
    reason: data?.reason,
  });

  return buildSuccessResponse(result);
}

/**
 * GET /wallet/holds/active
 */
async function getActiveHolds(
  driverId: string | null
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const result = await holdService.getActiveHolds(driverId);
  return buildSuccessResponse(result);
}

/**
 * POST /wallet/topup/request
 */
async function createTopupRequest(
  driverId: string | null,
  body: string | null
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const data = parseBody(body);

  if (!data.amount) {
    return buildErrorResponse(400, 'INVALID_REQUEST', 'amount is required');
  }

  const config = await getFundingConfig();
  if (!config.manual.enabled) throw fundingError('التحويل اليدوي غير متاح حالياً','METHOD_DISABLED',409);
  if (data.configVersion !== config.version) throw fundingError('تغيرت بيانات التحويل؛ أعد تحميل الإعدادات','CONFIG_CHANGED',409);
  if (typeof data.transferReference !== 'string' || !/^[a-zA-Z0-9-]{4,80}$/.test(data.transferReference)) throw fundingError('مرجع التحويل غير صالح');
  await validateReceipt(driverId, data.evidenceRef);
  const result = await topupService.createTopupRequest({
    idempotencyKey: data.idempotencyKey,
    transferReference: data.transferReference,
    fundingSnapshot: config.manual,
    driverId,
    amount: data.amount,
    method: data.method,
    evidenceRef: data.evidenceRef,
    note: data.note,
  });

  return buildSuccessResponse(result, 201);
}

/**
 * POST /wallet/topup/{topupId}/approve
 */
async function approveTopupRequest(
  topupId: string,
  adminId: string | null,
  body: string | null
): Promise<APIGatewayProxyResult> {
  if (!adminId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Admin ID not found in token');
  }

  const data = parseBody(body);

  const result = await topupService.approveTopupRequest({
    topupId,
    approvedById: adminId,
    approvedByRole: 'finance_manager',
    note: data?.note,
  });

  return buildSuccessResponse(result);
}

/**
 * POST /wallet/topup/{topupId}/reject
 */
async function rejectTopupRequest(
  topupId: string,
  adminId: string | null,
  body: string | null
): Promise<APIGatewayProxyResult> {
  if (!adminId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Admin ID not found in token');
  }

  const data = parseBody(body);

  if (!data.rejectionReason) {
    return buildErrorResponse(
      400,
      'INVALID_REQUEST',
      'rejectionReason is required'
    );
  }

  const result = await topupService.rejectTopupRequest({
    topupId,
    rejectedById: adminId,
    rejectedByRole: 'ADMIN',
    rejectionReason: data.rejectionReason,
  });

  return buildSuccessResponse(result);
}

/**
 * GET /wallet/topup/requests
 */
async function getTopupRequests(
  queryParams: any
): Promise<APIGatewayProxyResult> {
  const status = queryParams?.status;
  const result = await topupService.getTopupRequests(status);
  return buildSuccessResponse(result);
}

/**
 * GET /wallet/topup/my-requests
 */
async function getMyTopupRequests(
  driverId: string | null
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const result = await topupService.getMyTopupRequests(driverId);
  return buildSuccessResponse(result);
}

/**
 * POST /wallet/settlement/settle
 */
async function settleOrder(_body: string | null): Promise<APIGatewayProxyResult> {
  // Capture already credits the platform. The legacy second debit must never execute.
  return buildErrorResponse(409, 'LEGACY_SETTLEMENT_DISABLED', 'تتم تسوية المبلغ المحجوز بواسطة Capture؛ مسار الخصم الإضافي معطل');
}

/**
 * GET /wallet/settlement/order/{orderId}
 */
async function getSettlement(orderId: string): Promise<APIGatewayProxyResult> {
  const settlement = await settlementService.getSettlement(orderId);
  return buildSuccessResponse(settlement);
}

/**
 * GET /wallet/settlement/driver
 */
async function getDriverSettlements(
  driverId: string | null
): Promise<APIGatewayProxyResult> {
  if (!driverId) {
    return buildErrorResponse(401, 'UNAUTHORIZED', 'Driver ID not found in token');
  }

  const result = await settlementService.getDriverSettlements(driverId);
  return buildSuccessResponse(result);
}