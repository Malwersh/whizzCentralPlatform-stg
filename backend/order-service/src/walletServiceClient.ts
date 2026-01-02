/**
 * Wallet Service Client - handles communication with Wallet Service
 */

import axios, { AxiosInstance } from 'axios';
import { CognitoService } from './cognitoService';
import { ReleaseHoldRequest, ReleaseHoldResponse, HoldReleaseError } from './types';

export class WalletServiceClient {
  private axiosInstance: AxiosInstance;
  private cognitoService: CognitoService;
  private walletServiceUrl: string;

  constructor(cognitoService: CognitoService) {
    this.cognitoService = cognitoService;
    this.walletServiceUrl =
      process.env.WALLET_SERVICE_URL ||
      'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev';

    this.axiosInstance = axios.create({
      baseURL: this.walletServiceUrl,
      timeout: 30000, // 30 seconds
      headers: {
        'Content-Type': 'application/json',
      },
    });

    console.log('💼 Wallet Service Client initialized');
    console.log(`   URL: ${this.walletServiceUrl}`);
  }

  /**
   * Release a Hold via Wallet Service
   * Requires Service Token authentication
   */
  async releaseHold(holdId: string, reason: string): Promise<ReleaseHoldResponse> {
    console.log(`🔓 Releasing Hold: ${holdId}`);
    console.log(`   Reason: ${reason}`);

    try {
      // Get Service Token
      const serviceToken = await this.cognitoService.getServiceToken();

      // Call Wallet Service
      const response = await this.axiosInstance.post(
        `/wallet/hold/${holdId}/release`,
        { reason },
        {
          headers: {
            Authorization: `Bearer ${serviceToken}`,
          },
        }
      );

      console.log('✅ Hold released successfully:', response.data);

      return {
        success: true,
        holdId,
        message: response.data.message || 'Hold released successfully',
        walletBalance: response.data.walletBalance,
      };
    } catch (error: any) {
      console.error('❌ Failed to release Hold:', error.response?.data || error.message);

      // Extract error details
      const errorMessage =
        error.response?.data?.message ||
        error.response?.data?.error?.message ||
        error.message ||
        'Unknown error';

      const statusCode = error.response?.status || 500;

      // Handle specific error cases
      if (statusCode === 404) {
        throw new HoldReleaseError(`Hold not found: ${holdId}`);
      } else if (statusCode === 400) {
        // Hold already released or invalid state
        console.log('⚠️ Hold already released or invalid state - treating as success');
        return {
          success: true,
          holdId,
          message: 'Hold already released or not found',
        };
      } else if (statusCode === 401 || statusCode === 403) {
        // Authentication/Authorization error
        this.cognitoService.clearCache(); // Clear cached token
        throw new HoldReleaseError(`Authentication failed: ${errorMessage}`);
      } else {
        throw new HoldReleaseError(
          `Failed to release Hold: ${errorMessage} (Status: ${statusCode})`
        );
      }
    }
  }

  /**
   * Health check for Wallet Service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.axiosInstance.get('/health');
      return response.status === 200;
    } catch (error) {
      console.error('❌ Wallet Service health check failed:', error);
      return false;
    }
  }
}
