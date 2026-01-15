import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'me-south-1',
});

export const docClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false, // ✅ Important: Keep numbers as native JS numbers (not BigInt)
  },
});

// Table names from environment
export const TABLES = {
  WALLETS: process.env.WALLETS_TABLE || 'dev-Wallets',
  LEDGER: process.env.LEDGER_TABLE || 'dev-LedgerEntries',
  HOLDS: process.env.HOLDS_TABLE || 'dev-Holds',
  TOPUP_REQUESTS: process.env.TOPUP_REQUESTS_TABLE || 'dev-TopupRequests',
  AUDIT_LOG: process.env.AUDIT_LOG_TABLE || 'dev-AuditLog',
  IDEMPOTENCY_KEYS:
    process.env.IDEMPOTENCY_KEYS_TABLE || 'dev-IdempotencyKeys',
};

// Export commands for easier testing
export {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
};
