/**
 * Types for Order Service
 */

export interface CancelOrderRequest {
  orderId: string;
  canceledBy: 'driver' | 'customer' | 'restaurant' | 'system';
  reason: string;
  requestedBy: string; // userId, driverId, storeId, or serviceId
}

export interface CancelOrderResponse {
  success: boolean;
  orderId: string;
  newStatus: string;
  holdReleased: boolean;
  message?: string;
}

/**
 * Unassign Driver Request - فك ارتباط السائق من الطلب
 */
export interface UnassignDriverRequest {
  orderId: string;
  driverId: string;
  reason: string;
  requestedBy: string;  // للتحقق من الصلاحيات
}

/**
 * Unassign Driver Response
 */
export interface UnassignDriverResponse {
  success: boolean;
  orderId: string;
  oldDriverId: string;
  newStatus: 'reassigning';    // الطلب يصبح في حالة إعادة إسناد
  holdReleased: boolean;
  waveOfferId?: string;         // معرف الموجة الجديدة (إذا تم إنشاؤها)
  message: string;
}

/**
 * Order Timeline Event - تتبع كل حدث يحصل للطلب
 */
export interface OrderTimelineEvent {
  timestamp: string;           // ISO 8601 timestamp
  event: string;                // e.g., 'order_created', 'wave_sent', 'driver_accepted', 'driver_unassigned', 'order_cancelled'
  actor: string;                // Who did this: userId, driverId, storeId, or 'system'
  actorType: 'customer' | 'driver' | 'restaurant' | 'system';
  status?: string;              // New status after this event
  details?: Record<string, any>; // Additional context (e.g., waveNumber, reason, etc.)
}

/**
 * Driver History Entry - تاريخ السائقين الذين تم تعيينهم للطلب
 */
export interface DriverHistoryEntry {
  driverId: string;
  driverName?: string;
  driverPhone?: string;
  acceptedAt: string;           // متى قبل السائق
  unassignedAt?: string;        // متى فك الارتباط (إذا حصل)
  unassignReason?: string;      // سبب فك الارتباط
  lastStatus: string;           // آخر حالة وصل إليها السائق (e.g., 'heading_to_store', 'arrived_at_store')
  holdId?: string;              // Hold ID للسائق
  holdReleased: boolean;        // هل تم إطلاق Hold
}

/**
 * Excluded Driver Entry - السائقين المستبعدين من الطلب
 * يُستخدم لمنع إعادة إرسال الطلب لنفس السائق الذي فك ارتباطه أو رفضه
 */
export interface ExcludedDriver {
  driverId: string;
  excludedAt: string;           // متى تم الاستبعاد
  reason: 'unassigned' | 'rejected' | 'timeout';  // سبب الاستبعاد
  canRetryAfter?: string;       // null = دائم، timestamp = يمكن المحاولة بعد هذا الوقت
}

export interface Order {
  orderId: string;
  status: string;
  driverId?: string;
  userId?: string;
  customerId?: string;
  storeId?: string;
  businessId?: string;
  holdId?: string;
  holdStatus?: string;
  holdAmount?: number;
  total?: number;
  canceledAt?: string;
  canceledBy?: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  
  // 🆕 Timeline & History tracking
  orderTimeline?: OrderTimelineEvent[];   // تاريخ كل الأحداث
  driverHistory?: DriverHistoryEntry[];   // تاريخ جميع السائقين
  excludedDrivers?: ExcludedDriver[];     // 🆕 السائقين المستبعدين من الطلب
}

export interface ReleaseHoldRequest {
  holdId: string;
  reason: string;
}

export interface ReleaseHoldResponse {
  success: boolean;
  holdId: string;
  message: string;
  walletBalance?: {
    available: number;
    locked: number;
  };
}

export interface ServiceTokenInfo {
  token: string;
  expiresAt: number;
}

export class OrderServiceError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code: string = 'ORDER_SERVICE_ERROR'
  ) {
    super(message);
    this.name = 'OrderServiceError';
  }
}

export class OrderNotFoundError extends OrderServiceError {
  constructor(orderId: string) {
    super(`Order not found: ${orderId}`, 404, 'ORDER_NOT_FOUND');
  }
}

export class UnauthorizedError extends OrderServiceError {
  constructor(message: string) {
    super(message, 403, 'UNAUTHORIZED');
  }
}

export class InvalidStatusError extends OrderServiceError {
  constructor(currentStatus: string, canceledBy: string) {
    super(
      `Cannot cancel order in status '${currentStatus}' by '${canceledBy}'`,
      400,
      'INVALID_STATUS'
    );
  }
}

export class HoldReleaseError extends OrderServiceError {
  constructor(message: string) {
    super(message, 500, 'HOLD_RELEASE_FAILED');
  }
}
