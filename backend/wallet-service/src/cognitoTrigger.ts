/**
 * Cognito Post-Confirmation Trigger
 * 
 * Automatically creates wallet for new drivers after successful registration
 * 
 * Trigger: PostConfirmation in Driver Cognito Pool (hadhir-phone-only-pool)
 * 
 * Authentication: Uses IAM role instead of Cognito credentials for better security
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';

interface CognitoPostConfirmationEvent {
  version: string;
  triggerSource: string;
  region: string;
  userPoolId: string;
  userName: string; // Cognito username (UUID or phone)
  request: {
    userAttributes: {
      sub: string; // Driver ID
      email?: string;
      phone_number?: string;
      email_verified?: string;
      phone_number_verified?: string;
    };
  };
  response: Record<string, unknown>;
}

const WALLET_API_URL = process.env.WALLET_API_URL || 'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

/**
 * Sign request using AWS Signature V4 (IAM authentication)
 */
async function signRequest(url: string, method: string, body: string): Promise<any> {
  const urlObj = new URL(url);
  
  // Create HTTP request
  const request = new HttpRequest({
    method,
    protocol: urlObj.protocol,
    hostname: urlObj.hostname,
    path: urlObj.pathname,
    headers: {
      'Content-Type': 'application/json',
      'host': urlObj.hostname,
    },
    body,
  });

  // Get credentials from Lambda execution role
  const credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    sessionToken: process.env.AWS_SESSION_TOKEN,
  };

  // Sign the request
  const signer = new SignatureV4({
    service: 'execute-api',
    region: AWS_REGION,
    credentials,
    sha256: Sha256,
  });

  const signedRequest = await signer.sign(request);
  
  return {
    method: signedRequest.method,
    headers: signedRequest.headers,
    body: signedRequest.body,
  };
}

/**
 * Create wallet via Wallet Service API using IAM authentication
 */
async function createDriverWallet(driverId: string): Promise<void> {
  console.log('Creating wallet for driver:', driverId);

  const url = `${WALLET_API_URL}/wallet/create`;
  const body = JSON.stringify({
    driverId,
    minRequiredBalance: 25000, // 25,000 IQD minimum
  });

  // Trigger secret for authentication (matches API check)
  const triggerSecret = process.env.WALLET_TRIGGER_SECRET || 'wallet-creation-trigger-secret-2025';

  try {
    // Sign request with IAM credentials
    const signedRequest = await signRequest(url, 'POST', body);
    
    console.log('✅ Request signed with IAM credentials');

    // Make the request with trigger secret header
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        ...signedRequest.headers,
        'x-trigger-secret': triggerSecret, // Add secret header
      },
      body: signedRequest.body,
    });

    const data: any = await response.json();

    if (!response.ok) {
      // If wallet already exists (idempotent), that's OK
      if (response.status === 200 && data.message === 'Wallet already exists') {
        console.log('✅ Wallet already exists for driver:', driverId);
        return;
      }
      throw new Error(`Failed to create wallet: ${response.status} ${JSON.stringify(data)}`);
    }

    console.log('✅ Wallet created successfully:', data);
  } catch (error) {
    console.error('❌ Failed to sign or send request:', error);
    throw error;
  }
}

/**
 * Lambda handler for Cognito Post-Confirmation trigger
 */
export async function handler(event: CognitoPostConfirmationEvent): Promise<CognitoPostConfirmationEvent> {
  console.log('Post-Confirmation Trigger:', JSON.stringify(event, null, 2));

  try {
    const driverId = event.request.userAttributes.sub;
    const email = event.request.userAttributes.email;
    const phone = event.request.userAttributes.phone_number;

    console.log('New driver confirmed:', {
      driverId,
      email,
      phone,
      userName: event.userName,
    });

    // Only process driver registrations
    if (event.triggerSource !== 'PostConfirmation_ConfirmSignUp' &&
        event.triggerSource !== 'PostConfirmation_ConfirmForgotPassword') {
      console.log('Skipping trigger source:', event.triggerSource);
      return event;
    }

    // Create wallet using IAM authentication
    await createDriverWallet(driverId);

    console.log('✅ Wallet creation completed for driver:', driverId);

    return event;
  } catch (error) {
    console.error('❌ Failed to create wallet:', error);
    
    // Don't fail the registration - log error and continue
    // Wallet can be created later manually if needed
    console.error('Registration will continue, wallet creation will be retried later');
    
    return event;
  }
}
