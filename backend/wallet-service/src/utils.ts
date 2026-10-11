import { v4 as uuidv4 } from 'uuid';

/**
 * Generate unique transaction ID
 */
export function generateTxnId(prefix: string = 'txn'): string {
  const timestamp = Date.now();
  const random = uuidv4().split('-')[0];
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Generate wallet ID for driver
 */
export function generateDriverWalletId(driverId: string): string {
  return `WALLET#DRIVER#${driverId}`;
}

/**
 * Get platform wallet ID
 */
export function getPlatformWalletId(): string {
  return 'WALLET#PLATFORM';
}

/**
 * Generate sort key for ledger entry (for time-based sorting)
 */
export function generateLedgerSK(timestamp: string, entryId: string): string {
  return `ts#${timestamp}#${entryId}`;
}

/**
 * Generate date partition for audit log (YYYYMMDD)
 */
export function generateDatePartition(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `date#${year}${month}${day}`;
}

/**
 * Get current ISO timestamp
 */
export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Get timestamp N days from now (for TTL)
 */
export function getFutureTimestamp(days: number): string {
  const future = new Date();
  future.setDate(future.getDate() + days);
  return future.toISOString();
}

/**
 * Get TTL in epoch seconds (for DynamoDB TTL)
 */
export function getTTLEpoch(days: number): number {
  return Math.floor(Date.now() / 1000) + days * 24 * 60 * 60;
}

/**
 * Validate amount is positive integer
 */
export function validateAmount(amount: number): void {
  if (!Number.isSafeInteger(amount)) {
    throw new Error('Amount must be an integer');
  }
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }
}

/**
 * Format amount for display (IQD)
 */
export function formatAmount(amount: number): string {
  return `${amount.toLocaleString()} IQD`;
}

/**
 * Generate hold ID
 * Note: Uses underscores instead of # to avoid URL encoding issues
 */
export function generateHoldId(orderId?: string): string {
  const timestamp = Date.now();
  const random = uuidv4().split('-')[0];
  return orderId ? `HOLD_${orderId}` : `HOLD_${timestamp}_${random}`;
}

/**
 * Generate topup ID
 * Note: Uses underscores instead of # to avoid URL encoding issues
 */
export function generateTopupId(): string {
  const timestamp = Date.now();
  const random = uuidv4().split('-')[0];
  return `TOPUP_${timestamp}_${random}`;
}

/**
 * Generate status+createdAt for GSI
 */
export function generateStatusCreatedAt(
  status: string,
  createdAt: string
): string {
  return `${status}#${createdAt}`;
}

/**
 * Calculate hash of request body (for idempotency check)
 */
export function hashRequest(body: any): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
}

/**
 * Extract driver ID from Cognito token claims
 */
export function extractDriverId(claims: any): string {
  return claims.sub || claims['cognito:username'];
}

/**
 * Validate idempotency key format
 */
export function validateIdempotencyKey(key: string): void {
  if (!key || key.length < 10) {
    throw new Error('Invalid idempotency key');
  }
}

/**
 * Build error response
 */
export function buildErrorResponse(
  statusCode: number,
  code: string,
  message: string
) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({
      error: {
        code,
        message,
      },
    }),
  };
}

/**
 * Build success response
 */
export function buildSuccessResponse(data: any, statusCode: number = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(data),
  };
}

/**
 * Parse JSON body safely
 */
export function parseBody(body: string | null): any {
  if (!body) {
    throw new Error('Request body is required');
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error('Invalid JSON in request body');
  }
}
