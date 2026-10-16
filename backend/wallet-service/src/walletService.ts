import { docClient, TABLES, GetCommand, PutCommand, QueryCommand } from './db';
import {
  Wallet,
  LedgerEntry,
  CreateWalletRequest,
  CreateWalletResponse,
  GetWalletResponse,
  GetTransactionsResponse,
  WalletNotFoundError,
} from './types';
import {
  generateDriverWalletId,
  getPlatformWalletId,
  getCurrentTimestamp,
  validateAmount,
} from './utils';

/**
 * Wallet Service - Core Operations
 * 
 * Handles:
 * - Wallet creation
 * - Balance queries
 * - Transaction history
 */
export class WalletService {
  /**
   * Create a new wallet for a driver
   */
  async createWallet(request: CreateWalletRequest): Promise<CreateWalletResponse> {
    const walletId = generateDriverWalletId(request.driverId);
    const now = getCurrentTimestamp();

    const wallet: Wallet = {
      walletId,
      sk: 'META',
      ownerType: 'DRIVER',
      ownerId: request.driverId,
      currency: 'IQD',
      status: 'ACTIVE',
      availableBalance: 0,
      lockedBalance: 0,
      minRequiredBalance: request.minRequiredBalance || 25000,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

    await docClient.send(
      new PutCommand({
        TableName: TABLES.WALLETS,
        Item: wallet,
        ConditionExpression: 'attribute_not_exists(walletId)',
      })
    );

    return {
      walletId: wallet.walletId,
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      status: wallet.status,
    };
  }

  /**
   * Get wallet by ID
   */
  async getWallet(walletId: string): Promise<GetWalletResponse> {
    const result = await docClient.send(
      new GetCommand({
        TableName: TABLES.WALLETS,
        Key: {
          walletId,
          sk: 'META',
        },
      })
    );

    if (!result.Item) {
      throw new WalletNotFoundError(walletId);
    }

    const wallet = result.Item as Wallet;

    return {
      walletId: wallet.walletId,
      availableBalance: wallet.availableBalance,
      lockedBalance: wallet.lockedBalance,
      minRequiredBalance: wallet.minRequiredBalance,
      status: wallet.status,
      currency: wallet.currency,
    };
  }

  /**
   * Get wallet transactions (ledger entries)
   */
  async getTransactions(
    walletId: string,
    limit: number = 50,
    lastEvaluatedKey?: string
  ): Promise<GetTransactionsResponse> {
    // Decode continuation token (if provided) into an ExclusiveStartKey.
    // Invalid tokens are ignored so pagination fails safe to the first page.
    let exclusiveStartKey: Record<string, any> | undefined;
    if (lastEvaluatedKey) {
      try {
        exclusiveStartKey = JSON.parse(lastEvaluatedKey);
      } catch (error) {
        console.warn('Invalid pagination token ignored:', lastEvaluatedKey);
        exclusiveStartKey = undefined;
      }
    }

    const result = await docClient.send(
      new QueryCommand({
        TableName: TABLES.LEDGER,
        KeyConditionExpression: 'walletId = :walletId AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':walletId': walletId,
          ':prefix': 'ts#',
        },
        Limit: limit,
        ScanIndexForward: false, // Most recent first
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const nextToken = result.LastEvaluatedKey
      ? JSON.stringify(result.LastEvaluatedKey)
      : undefined;

    return {
      transactions: (result.Items || []) as LedgerEntry[],
      nextToken,
      lastEvaluatedKey: nextToken,
    };
  }

  /**
   * Check if wallet has sufficient balance
   */
  async checkBalance(walletId: string, requiredAmount: number): Promise<boolean> {
    validateAmount(requiredAmount);
    
    const wallet = await this.getWallet(walletId);
    return wallet.availableBalance >= requiredAmount;
  }

  /**
   * Get platform wallet
   */
  async getPlatformWallet(): Promise<GetWalletResponse> {
    return this.getWallet(getPlatformWalletId());
  }

  /**
   * Create platform wallet (one-time initialization)
   */
  async createPlatformWallet(): Promise<CreateWalletResponse> {
    const walletId = getPlatformWalletId();
    const now = getCurrentTimestamp();

    const wallet: Wallet = {
      walletId,
      sk: 'META',
      ownerType: 'PLATFORM',
      ownerId: 'PLATFORM',
      currency: 'IQD',
      status: 'ACTIVE',
      availableBalance: 0, // Will be credited from topups
      lockedBalance: 0,
      minRequiredBalance: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await docClient.send(
        new PutCommand({
          TableName: TABLES.WALLETS,
          Item: wallet,
          ConditionExpression: 'attribute_not_exists(walletId)',
        })
      );

      return {
        walletId: wallet.walletId,
        availableBalance: wallet.availableBalance,
        lockedBalance: wallet.lockedBalance,
        status: wallet.status,
      };
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Already exists, return current state
        return this.getPlatformWallet();
      }
      throw error;
    }
  }
}

// Singleton instance
export const walletService = new WalletService();
