/**
 * DynamoDB Client for Order Service
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true, // Remove undefined values automatically
    convertEmptyValues: false,
  },
});

// Resolve table names robustly, treating 'null', 'undefined' and empty strings as unset
function resolveTableName(envValue: string | undefined, fallback: string): string {
  const raw = (envValue || '').trim();
  if (!raw) return fallback;
  const lowered = raw.toLowerCase();
  if (lowered === 'null' || lowered === 'undefined') return fallback;
  return raw;
}

export const TABLES = {
  ORDERS: resolveTableName(process.env.ORDERS_TABLE, 'WizzOrders'),
};

// Startup diagnostics to help trace environment issues
console.log('🗄️ OrderService DynamoDB config:', {
  region: process.env.AWS_REGION || 'us-east-1',
  ORDERS_TABLE: TABLES.ORDERS,
});

export { GetCommand, UpdateCommand, QueryCommand };
