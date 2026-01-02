/**
 * Wallet Service Client for Backend Services
 * 
 * This client handles:
 * 1. Authentication with Service Cognito Pool
 * 2. Token management (auto-refresh)
 * 3. API calls to Wallet Service
 * 
 * Usage in Order Service:
 * 
 * const walletClient = new WalletServiceClient({
 *   userPoolId: process.env.SERVICE_USER_POOL_ID,
 *   clientId: process.env.SERVICE_CLIENT_ID,
 *   username: process.env.SERVICE_USERNAME,
 *   password: process.env.SERVICE_PASSWORD,
 * });
 * 
 * // Create hold when order is created
 * const hold = await walletClient.createHold({
 *   walletId: 'driver-7901234567',
 *   amount: 5000,
 *   orderId: 'order-123'
 * });
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';

export interface WalletServiceClientConfig {
  userPoolId: string;
  clientId: string;
  username: string;
  password: string;
  region?: string;
  apiBaseUrl?: string;
}

export interface CreateHoldRequest {
  walletId: string;
  amount: number;
  orderId: string;
  description?: string;
}

export interface CaptureHoldRequest {
  amount?: number;
  platformFee?: number;
}

export interface SettleOrderRequest {
  orderId: string;
  driverId: string;
  totalAmount: number;
  platformFee: number;
  driverEarnings: number;
}

export class WalletServiceClient {
  private cognitoClient: CognitoIdentityProviderClient;
  private config: WalletServiceClientConfig;
  private accessToken: string | null = null;
  private tokenExpiry: Date | null = null;

  constructor(config: WalletServiceClientConfig) {
    this.config = {
      region: 'us-east-1',
      apiBaseUrl: 'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev',
      ...config,
    };

    this.cognitoClient = new CognitoIdentityProviderClient({
      region: this.config.region,
    });
  }

  /**
   * Authenticate with Cognito and get access token
   */
  private async authenticate(): Promise<void> {
    console.log('Authenticating service account:', this.config.username);

    const command = new InitiateAuthCommand({
      AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
      ClientId: this.config.clientId,
      AuthParameters: {
        USERNAME: this.config.username,
        PASSWORD: this.config.password,
      },
    });

    const response = await this.cognitoClient.send(command);

    if (!response.AuthenticationResult?.AccessToken) {
      throw new Error('Authentication failed: No access token received');
    }

    this.accessToken = response.AuthenticationResult.AccessToken;
    
    // Token expires in 1 hour (3600 seconds)
    const expiresIn = response.AuthenticationResult.ExpiresIn || 3600;
    this.tokenExpiry = new Date(Date.now() + expiresIn * 1000);

    console.log('Authentication successful. Token expires at:', this.tokenExpiry);
  }

  /**
   * Get valid access token (auto-refresh if expired)
   */
  private async getToken(): Promise<string> {
    const now = new Date();
    
    // Refresh token 5 minutes before expiry
    const refreshThreshold = new Date(Date.now() + 5 * 60 * 1000);

    if (!this.accessToken || !this.tokenExpiry || this.tokenExpiry < refreshThreshold) {
      await this.authenticate();
    }

    return this.accessToken!;
  }

  /**
   * Make authenticated API request
   */
  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${this.config.apiBaseUrl}${path}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API request failed (${response.status}): ${error}`);
    }

    return response.json();
  }

  /**
   * Create hold on driver's wallet
   */
  async createHold(request: CreateHoldRequest): Promise<any> {
    return this.request('/wallet/hold/create', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Release hold (cancel order)
   */
  async releaseHold(holdId: string): Promise<any> {
    return this.request(`/wallet/hold/${holdId}/release`, {
      method: 'POST',
    });
  }

  /**
   * Capture hold (order completed)
   */
  async captureHold(holdId: string, request: CaptureHoldRequest): Promise<any> {
    return this.request(`/wallet/hold/${holdId}/capture`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Settle order (final settlement)
   */
  async settleOrder(request: SettleOrderRequest): Promise<any> {
    return this.request('/wallet/settlement/settle', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get settlement details
   */
  async getSettlement(orderId: string): Promise<any> {
    return this.request(`/wallet/settlement/order/${orderId}`, {
      method: 'GET',
    });
  }

  /**
   * Create wallet (when driver registers)
   */
  async createWallet(driverId: string): Promise<any> {
    return this.request('/wallet/create', {
      method: 'POST',
      body: JSON.stringify({ driverId }),
    });
  }
}

/**
 * Example usage in Order Service
 */

// Initialize client (do this once at service startup)
const walletClient = new WalletServiceClient({
  userPoolId: process.env.SERVICE_USER_POOL_ID!,
  clientId: process.env.SERVICE_CLIENT_ID!,
  username: process.env.SERVICE_USERNAME!, // e.g., "order-service-dev"
  password: process.env.SERVICE_PASSWORD!, // From Secrets Manager
});

// Example: Create hold when order is created
export async function handleOrderCreated(order: any) {
  try {
    const hold = await walletClient.createHold({
      walletId: order.driverId,
      amount: order.totalAmount,
      orderId: order.id,
      description: `Hold for order ${order.id}`,
    });

    console.log('Hold created:', hold);
    return hold;
  } catch (error) {
    console.error('Failed to create hold:', error);
    throw error;
  }
}

// Example: Release hold when order is cancelled
export async function handleOrderCancelled(order: any) {
  try {
    await walletClient.releaseHold(order.holdId);
    console.log('Hold released for order:', order.id);
  } catch (error) {
    console.error('Failed to release hold:', error);
    throw error;
  }
}

// Example: Capture hold and settle when order is completed
export async function handleOrderCompleted(order: any) {
  try {
    // Step 1: Capture hold
    await walletClient.captureHold(order.holdId, {
      amount: order.finalAmount,
      platformFee: order.platformFee,
    });

    // Step 2: Settle order
    const settlement = await walletClient.settleOrder({
      orderId: order.id,
      driverId: order.driverId,
      totalAmount: order.finalAmount,
      platformFee: order.platformFee,
      driverEarnings: order.finalAmount - order.platformFee,
    });

    console.log('Order settled:', settlement);
    return settlement;
  } catch (error) {
    console.error('Failed to complete order:', error);
    throw error;
  }
}
