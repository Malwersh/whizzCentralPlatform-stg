import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { walletBindings } from './walletBindings';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';

const bindings = walletBindings();
const client = new DynamoDBClient({ region: bindings.region });

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
export const TABLES = bindings.tables;

// Export commands for easier testing
export {
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  TransactWriteCommand,
};
