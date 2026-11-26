// Wallet Types and Interfaces

export interface Wallet {
  walletId: string;
  sk: string;
  ownerType: 'DRIVER' | 'PLATFORM';
  ownerId: string;
  currency: 'IQD';
  status: 'ACTIVE' | 'SUSPENDED' | 'CLOSED';
  availableBalance: number; // Integer in IQD
  lockedBalance: number; // Integer in IQD
  minRequiredBalance: number; // Integer in IQD
  version: number;
  createdAt: string;
  updatedAt: string;
  lastTxnAt?: string;
  suspendReason?: string;
  riskFlags?: string[];
  notes?: string;
}

export interface LedgerEntry {
  walletId: string;
  sk: string; // ts#{timestamp}#{suffix}
  txnId?: string; // OLD - for backward compatibility
  transactionId: string;
  type: 'DEBIT' | 'CREDIT' | 'HOLD_CREATED' | 'HOLD_RELEASED' | 'HOLD_CAPTURED' | 'HOLD_PARTIAL_RELEASE' | 'TOPUP' | 'SETTLEMENT_RECEIVED';
  category?:
    | 'HOLD_CREATED'
    | 'HOLD_RELEASED'
    | 'HOLD_CAPTURED'
    | 'HOLD_PARTIAL_RELEASE'
    | 'TOPUP'
    | 'PLATFORM_FEE'
    | 'ORDER_EARNINGS'
    | 'TRANSFER'
    | 'ADJUSTMENT'
    | 'REVERSAL';
  amount: number; // Can be positive or negative
  balance?: number; // OLD - for backward compatibility
  balanceBefore?: number;
  balanceAfter?: number;
  relatedEntityId?: string;
  relatedEntityType?: 'HOLD' | 'TOPUP' | 'SETTLEMENT' | 'ORDER';
  description: string;
  metadata?: Record<string, any>;
  timestamp?: string; // OLD - for backward compatibility
  createdAt: string;
}

export interface Hold {
  holdId: string;
  sk: string; // META or HOLD
  orderId: string;
  walletId: string;
  driverId?: string;
  amount: number; // Integer in IQD
  status: 'ACTIVE' | 'RELEASED' | 'CAPTURED' | 'SETTLED';
  statusCreatedAt?: string; // For GSI: "ACTIVE#timestamp", "RELEASED#timestamp", etc.
  reason?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
  releasedAt?: string;
  capturedAt?: string;
  capturedAmount?: number;
  settledAt?: string;
}

export interface TopupRequest {
  topupId: string;
  sk: string; // META
  driverId: string;
  walletId: string;
  amount: number; // Integer in IQD
  transferReference?: string;
  fundingSnapshot?: any;
  method: 'CASH_AGENT' | 'MANUAL_VERIFICATION' | 'BANK_TRANSFER';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'POSTED' | 'CANCELED';
  createdAt: string;
  updatedAt: string;
  createdById: string;
  createdByRole: 'DRIVER' | 'AGENT' | 'ADMIN';
  approvedById?: string;
  approvedByRole?: 'ADMIN' | 'AGENT' | 'finance_manager';
  approvedAt?: string;
  approvalNote?: string;
  rejectedById?: string;
  rejectedByRole?: 'ADMIN' | 'AGENT' | 'finance_manager';
  rejectedAt?: string;
  rejectionReason?: string;
  evidenceRef?: string;
  note?: string;
}

export interface Settlement {
  settlementId: string; // SETTLEMENT#{orderId}
  sk: string; // META
  orderId: string;
  holdId: string;
  driverId: string;
  driverWalletId: string;
  platformWalletId: string;
  capturedAmount: number; // Total captured from hold
  platformFeeAmount: number; // Fee collected by platform
  driverNetAmount: number; // Amount kept by driver (capturedAmount - platformFeeAmount)
  transactionId: string;
  status: 'COMPLETED' | 'FAILED' | 'REVERSED';
  settledAt: string;
  settledBy: string;
  settledByRole: 'SYSTEM' | 'ADMIN';
  reversedAt?: string;
  reversedBy?: string;
  reversalReason?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface AuditLog {
  logId: string;
  sk: string; // ts#{timestamp}
  datePartition: string; // date#YYYYMMDD
  action:
    | 'CREATE_HOLD'
    | 'RELEASE_HOLD'
    | 'CAPTURE_HOLD'
    | 'CREATE_TOPUP'
    | 'APPROVE_TOPUP'
    | 'REJECT_TOPUP'
    | 'SETTLE_ORDER'
    | 'WALLET_SUSPEND'
    | 'WALLET_ADJUST'
    | 'TRANSFER';
  entityType: 'WALLET' | 'TOPUP' | 'ORDER' | 'HOLD' | 'SETTLEMENT';
  entityId: string;
  performedBy: string;
  performedByRole: 'ADMIN' | 'SYSTEM' | 'SERVICE' | 'DRIVER' | 'AGENT';
  timestamp: string;
  details: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface IdempotencyKey {
  idempotencyKey: string;
  sk: string; // META
  operation: 'SETTLE' | 'HOLD' | 'TOPUP_APPROVE' | 'CREDIT' | 'TRANSFER';
  status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  createdAt: string;
  completedAt?: string;
  expiresAt: string; // TTL
  resultRef?: string; // txnId or topupId
  requestHash?: string;
  errorMessage?: string;
}

// API Request/Response Types

export interface CreateWalletRequest {
  driverId: string;
  minRequiredBalance?: number;
}

export interface CreateWalletResponse {
  walletId: string;
  availableBalance: number;
  lockedBalance: number;
  status: string;
}

export interface GetWalletResponse {
  walletId: string;
  availableBalance: number;
  lockedBalance: number;
  minRequiredBalance: number;
  status: string;
  currency: string;
}

export interface GetTransactionsRequest {
  walletId: string;
  limit?: number;
  lastEvaluatedKey?: string;
}

export interface GetTransactionsResponse {
  transactions: LedgerEntry[];
  nextToken?: string;
  lastEvaluatedKey?: string;
}

export interface HoldRequest {
  driverId: string;
  orderId: string;
  amount: number;
  idempotencyKey: string;
}

export interface HoldResponse {
  success: boolean;
  holdId: string;
  walletBalance: {
    available: number;
    locked: number;
  };
}

// Error Types

export class WalletError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400
  ) {
    super(message);
    this.name = 'WalletError';
  }
}

export class InsufficientBalanceError extends WalletError {
  constructor(available: number, required: number) {
    super(
      `Insufficient balance. Available: ${available}, Required: ${required}`,
      'INSUFFICIENT_BALANCE',
      400
    );
  }
}

export class IdempotencyConflictError extends WalletError {
  constructor(key: string) {
    super(
      `Idempotency key already used: ${key}`,
      'IDEMPOTENCY_CONFLICT',
      409
    );
  }
}

export class ConcurrentModificationError extends WalletError {
  constructor(message: string = 'Wallet was modified concurrently. Please retry.') {
    super(message, 'CONCURRENT_MODIFICATION', 409);
  }
}

export class WalletNotFoundError extends WalletError {
  constructor(walletId: string) {
    super(`Wallet not found: ${walletId}`, 'WALLET_NOT_FOUND', 404);
  }
}

export class HoldNotFoundError extends WalletError {
  constructor(orderId: string) {
    super(`Hold not found for order: ${orderId}`, 'HOLD_NOT_FOUND', 404);
  }
}

export class AlreadySettledError extends WalletError {
  constructor(orderId: string) {
    super(`Order already settled: ${orderId}`, 'ALREADY_SETTLED', 409);
  }
}

export class InvalidHoldStateError extends WalletError {
  constructor(message: string) {
    super(message, 'INVALID_HOLD_STATE', 400);
  }
}

export class TopupNotFoundError extends WalletError {
  constructor(message: string) {
    super(message, 'TOPUP_NOT_FOUND', 404);
  }
}

export class InvalidTopupStateError extends WalletError {
  constructor(message: string) {
    super(message, 'INVALID_TOPUP_STATE', 400);
  }
}

export class SettlementError extends WalletError {
  constructor(message: string) {
    super(message, 'SETTLEMENT_ERROR', 400);
  }
}

export class SettlementNotFoundError extends WalletError {
  constructor(message: string) {
    super(message, 'SETTLEMENT_NOT_FOUND', 404);
  }
}

// Hold Service Request/Response Types

export interface CreateHoldRequest {
  walletId: string;  // Can be any wallet (driver, platform, etc.)
  amount: number;
  orderId: string;
  reason?: string;
  metadata?: Record<string, any>;
  assignmentAttempt?: number; // For reassignments - allows different idempotency keys
}

export interface CreateHoldResponse {
  success: boolean;
  hold: Hold;
  message: string;
}

export interface ReleaseHoldRequest {
  holdId: string;
  reason?: string;
}

export interface ReleaseHoldResponse {
  success: boolean;
  holdId: string;
  message: string;
  walletBalance: {
    available: number;
    locked: number;
  };
}

export interface CaptureHoldRequest {
  holdId: string;
  actualAmount?: number; // If partial capture
  reason?: string;
}

export interface CaptureHoldResponse {
  success: boolean;
  holdId: string;
  capturedAmount: number;
  releasedAmount: number;
  message: string;
}

export interface GetActiveHoldsResponse {
  success: boolean;
  holds: Hold[];
  totalLocked: number;
  count: number;
}

// Topup Service Request/Response Types

export interface CreateTopupRequestRequest {
  idempotencyKey?: string;
  transferReference?: string;
  fundingSnapshot?: any;
  driverId: string;
  amount: number;
  method?: 'CASH_AGENT' | 'MANUAL_VERIFICATION' | 'BANK_TRANSFER';
  evidenceRef?: string;
  note?: string;
}

export interface CreateTopupRequestResponse {
  success: boolean;
  topupRequest: TopupRequest;
  message: string;
}

export interface ApproveTopupRequest {
  topupId: string;
  approvedById: string;
  approvedByRole: 'ADMIN' | 'AGENT' | 'finance_manager';
  note?: string;
}

export interface ApproveTopupResponse {
  success: boolean;
  topupId: string;
  message: string;
  newBalance: number;
}

export interface RejectTopupRequest {
  topupId: string;
  rejectedById: string;
  rejectedByRole: 'ADMIN' | 'AGENT' | 'finance_manager';
  rejectionReason: string;
}

export interface RejectTopupResponse {
  success: boolean;
  topupId: string;
  message: string;
}

export interface GetTopupRequestsResponse {
  cursor?: string;
  success: boolean;
  requests: TopupRequest[];
  count: number;
}

// Settlement Service Request/Response Types

export interface SettleOrderRequest {
  orderId: string;
  driverId: string;
  platformFeeAmount: number;
  settledBy: string;
  settledByRole: 'SYSTEM' | 'ADMIN';
  metadata?: Record<string, any>;
}

export interface SettleOrderResponse {
  settlementId: string;
  orderId: string;
  transactionId: string;
  capturedAmount: number;
  platformFeeAmount: number;
  driverNetAmount: number;
  driverWalletBalance: number;
  platformWalletBalance: number;
  settledAt: string;
}

export interface GetSettlementsResponse {
  settlements: Settlement[];
  count: number;
}
