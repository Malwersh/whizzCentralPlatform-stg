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
import { WalletError } from './types';

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
  console.log('Wallet Service Request:', {
    path: event.path,
    method: event.httpMethod,
    resource: event.resource,
  });

  try {
    const path = event.path;
    const method = event.httpMethod;

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
      return await getPlatformWallet();
    }

    if (path === '/wallet/platform/create' && method === 'POST') {
      return await createPlatformWallet();
    }

    // Generic wallet endpoint (after specific routes)
    if (path.startsWith('/wallet/') && method === 'GET' && !path.includes('/hold') && !path.includes('/topup') && !path.includes('/settlement')) {
      // GET /wallet/{walletId} - Admin only (will add auth check later)
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
  const wallet = await walletService.getWallet(walletId);

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

  const transactions = await walletService.getTransactions(walletId, limit);

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

  const result = await topupService.createTopupRequest({
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
    approvedByRole: 'ADMIN',
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
async function settleOrder(body: string | null): Promise<APIGatewayProxyResult> {
  const data = parseBody(body);

  if (!data.orderId || !data.driverId || !data.platformFeeAmount) {
    return buildErrorResponse(
      400,
      'INVALID_REQUEST',
      'orderId, driverId, and platformFeeAmount are required'
    );
  }

  if (!data.settledBy || !data.settledByRole) {
    return buildErrorResponse(
      400,
      'INVALID_REQUEST',
      'settledBy and settledByRole are required'
    );
  }

  const result = await settlementService.settleOrder({
    orderId: data.orderId,
    driverId: data.driverId,
    platformFeeAmount: data.platformFeeAmount,
    settledBy: data.settledBy,
    settledByRole: data.settledByRole,
    metadata: data.metadata,
  });

  return buildSuccessResponse(result);
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