/**
 * Cognito Service - manages Service Token for Wallet Service calls
 */

import {
  CognitoIdentityProviderClient,
  InitiateAuthCommand,
  AuthFlowType,
} from '@aws-sdk/client-cognito-identity-provider';
import { createHmac } from 'crypto';
import { ServiceTokenInfo } from './types';

export class CognitoService {
  private client: CognitoIdentityProviderClient;
  private cachedToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor() {
    this.client = new CognitoIdentityProviderClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Calculate SECRET_HASH for Cognito authentication
   * Required when App Client has Client Secret configured
   */
  private calculateSecretHash(username: string, clientId: string, clientSecret: string): string {
    const message = username + clientId;
    const hmac = createHmac('sha256', clientSecret);
    hmac.update(message);
    return hmac.digest('base64');
  }

  /**
   * Get Service Token from Cognito Service Pool
   * Caches token for 50 minutes (token valid for 1 hour)
   */
  async getServiceToken(): Promise<string> {
    console.log('🔑 Getting Service Token...');

    // Return cached token if still valid (with 10-minute buffer)
    if (this.cachedToken && Date.now() < this.tokenExpiry) {
      console.log('✅ Using cached Service Token');
      return this.cachedToken;
    }

    console.log('🔄 Fetching new Service Token from Cognito...');

    const clientId = process.env.SERVICE_COGNITO_CLIENT_ID;
    const clientSecret = process.env.SERVICE_COGNITO_CLIENT_SECRET;
    const username = process.env.SERVICE_USERNAME || 'order-service-dev';
    const password = process.env.SERVICE_PASSWORD;

    if (!clientId || !password) {
      throw new Error(
        'Missing Cognito Service Pool credentials: SERVICE_COGNITO_CLIENT_ID or SERVICE_PASSWORD'
      );
    }

    try {
      const authParameters: Record<string, string> = {
        USERNAME: username,
        PASSWORD: password,
      };

      // Add SECRET_HASH if Client Secret is configured
      if (clientSecret) {
        const secretHash = this.calculateSecretHash(username, clientId, clientSecret);
        authParameters.SECRET_HASH = secretHash;
        console.log('🔐 Using SECRET_HASH for authentication');
      }

      const command = new InitiateAuthCommand({
        AuthFlow: AuthFlowType.USER_PASSWORD_AUTH,
        ClientId: clientId,
        AuthParameters: authParameters,
      });

      const response = await this.client.send(command);

      if (!response.AuthenticationResult?.AccessToken) {
        throw new Error('Failed to get Service Token: No AccessToken in response');
      }

      this.cachedToken = response.AuthenticationResult.AccessToken;
      // Cache for 50 minutes (tokens valid for 60 minutes)
      this.tokenExpiry = Date.now() + 50 * 60 * 1000;

      console.log('✅ Service Token obtained successfully');
      console.log(`   Token expires in: 50 minutes (${new Date(this.tokenExpiry).toISOString()})`);

      return this.cachedToken;
    } catch (error: any) {
      console.error('❌ Failed to get Service Token:', error);
      throw new Error(`Cognito authentication failed: ${error.message}`);
    }
  }

  /**
   * Clear cached token (useful for testing or error recovery)
   */
  clearCache(): void {
    console.log('🗑️ Clearing cached Service Token');
    this.cachedToken = null;
    this.tokenExpiry = 0;
  }
}
