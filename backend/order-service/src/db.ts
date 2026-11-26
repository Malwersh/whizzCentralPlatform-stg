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

import {orderBindings} from './orderBindings';
export const TABLES = { ORDERS: orderBindings().tables.ORDERS_TABLE };

// Startup diagnostics to help trace environment issues
console.log('🗄️ OrderService DynamoDB config:', {
  region: process.env.AWS_REGION || 'us-east-1',
  ORDERS_TABLE: TABLES.ORDERS,
});

export { GetCommand, UpdateCommand, QueryCommand };
