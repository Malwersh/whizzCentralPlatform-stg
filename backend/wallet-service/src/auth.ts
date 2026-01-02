/**
 * Authentication & Authorization Utilities
 * Handles extraction of user info from Cognito JWT tokens
 * Supports 3 types of authentication:
 * 1. Driver authentication (phone-based)
 * 2. Admin authentication (email-based)
 * 3. Service authentication (machine-to-machine)
 */

export interface DriverInfo {
  userType: 'driver';
  driverId: string;
  phoneNumber?: string;
  permissions: string[];
}

export interface AdminInfo {
  userType: 'admin';
  adminEmail: string;
  adminId: string;
  permissions: string[];
}

export interface ServiceInfo {
  userType: 'service';
  serviceName: string;
  serviceRole: string;
  serviceId: string;
  permissions: string[];
}

export type AuthInfo = DriverInfo | AdminInfo | ServiceInfo | null;

/**
 * Service role permissions mapping
 */
const SERVICE_ROLE_PERMISSIONS: Record<string, string[]> = {
  'order_manager': [
    'create_wallet',
    'create_hold',
    'capture_hold',
    'release_hold',
    'view_hold'
  ],
  'settlement_manager': [
    'settle_order',
    'view_settlements',
    'get_settlement'
  ],
  'platform_admin': ['*'], // Full access
};

/**
 * Extract authentication info from Cognito claims
 */
export function extractAuthInfo(claims: any): AuthInfo {
  if (!claims) {
    return null;
  }

  // Check for service account (has cognito:groups with ServiceAccounts)
  const groups = claims['cognito:groups'] || [];
  if (groups.includes('ServiceAccounts')) {
    // Determine service name and role from username
    const username = claims.username || '';
    let serviceName = 'unknown';
    let serviceRole = 'unknown';

    if (username.includes('order-service')) {
      serviceName = 'order-service';
      serviceRole = 'order_manager';
    } else if (username.includes('settlement-service')) {
      serviceName = 'settlement-service';
      serviceRole = 'settlement_manager';
    } else if (username.includes('platform-admin')) {
      serviceName = 'platform-service';
      serviceRole = 'platform_admin';
    }

    return {
      userType: 'service',
      serviceName,
      serviceRole,
      serviceId: claims.sub,
      permissions: SERVICE_ROLE_PERMISSIONS[serviceRole] || [],
    };
  }

  // Check for admin (has email)
  if (claims.email) {
    return {
      userType: 'admin',
      adminEmail: claims.email,
      adminId: claims.sub,
      permissions: [
        'approve_topup',
        'reject_topup',
        'view_all_topups',
        'view_any_wallet',
        'view_platform_wallet',
        'create_platform_wallet'
      ],
    };
  }

  // Check for driver (has phone_number)
  if (claims.phone_number) {
    const phoneNumber = claims.phone_number;
    const driverId = extractDriverIdFromPhone(phoneNumber);

    return {
      userType: 'driver',
      driverId,
      phoneNumber,
      permissions: [
        'read_own_wallet',
        'read_own_transactions',
        'request_topup',
        'view_own_topups',
        'view_own_holds',
        'view_own_settlements'
      ],
    };
  }

  return null;
}

/**
 * Extract driver ID from phone number
 * Converts +964790XXXXXXX to driver-790XXXXXXX
 */
function extractDriverIdFromPhone(phoneNumber: string): string {
  // Remove +964 country code and format as driver ID
  const cleanPhone = phoneNumber.replace(/^\+964/, '');
  return `driver-${cleanPhone}`;
}

/**
 * Check if user has specific permission
 */
export function hasPermission(authInfo: AuthInfo, permission: string): boolean {
  if (!authInfo) {
    return false;
  }

  // Platform admin has all permissions
  if (authInfo.userType === 'service' && authInfo.permissions.includes('*')) {
    return true;
  }

  return authInfo.permissions.includes(permission);
}

/**
 * Validate that the authenticated user can perform operation on a wallet
 */
export function canAccessWallet(authInfo: AuthInfo, walletId: string): boolean {
  if (!authInfo) {
    return false;
  }

  // Admins can access any wallet
  if (authInfo.userType === 'admin') {
    return true;
  }

  // Services with platform_admin can access any wallet
  if (authInfo.userType === 'service' && authInfo.permissions.includes('*')) {
    return true;
  }

  // Drivers can only access their own wallet
  if (authInfo.userType === 'driver') {
    return walletId === authInfo.driverId || walletId === `driver-${authInfo.driverId}`;
  }

  return false;
}

/**
 * Get actor identifier for audit logs
 */
export function getActorIdentifier(authInfo: AuthInfo): string {
  if (!authInfo) {
    return 'anonymous';
  }

  switch (authInfo.userType) {
    case 'driver':
      return `driver:${authInfo.driverId}`;
    case 'admin':
      return `admin:${authInfo.adminEmail}`;
    case 'service':
      return `service:${authInfo.serviceName}`;
    default:
      return 'unknown';
  }
}

/**
 * Require specific permission or throw error
 */
export function requirePermission(authInfo: AuthInfo, permission: string): void {
  if (!hasPermission(authInfo, permission)) {
    const actor = getActorIdentifier(authInfo);
    throw new Error(
      `Forbidden: ${actor} does not have permission '${permission}'`
    );
  }
}

/**
 * Require service authentication or throw error
 */
export function requireServiceAuth(authInfo: AuthInfo): ServiceInfo {
  if (!authInfo || authInfo.userType !== 'service') {
    throw new Error('Forbidden: This endpoint requires service authentication');
  }
  return authInfo;
}

/**
 * Require admin authentication or throw error
 */
export function requireAdminAuth(authInfo: AuthInfo): AdminInfo {
  if (!authInfo || authInfo.userType !== 'admin') {
    throw new Error('Forbidden: This endpoint requires admin authentication');
  }
  return authInfo;
}

/**
 * Require driver authentication or throw error
 */
export function requireDriverAuth(authInfo: AuthInfo): DriverInfo {
  if (!authInfo || authInfo.userType !== 'driver') {
    throw new Error('Forbidden: This endpoint requires driver authentication');
  }
  return authInfo;
}
