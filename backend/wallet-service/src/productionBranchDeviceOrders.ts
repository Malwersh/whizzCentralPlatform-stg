import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createProductionMerchantOrderResponses, DeviceOrderPermission } from './productionMerchantOrderResponses';
import { createDeviceAuthority } from './productionBranchDeviceAuthority';
import type { FinancialRow as Row } from './driverFinancialTransaction';

export function createDeviceOrderAuthority(db: Pick<DynamoDBDocumentClient, 'send'>, env = process.env, now = Date.now) {
  const authorize = createDeviceAuthority(db, env, now);
  return (event: Row, branchId: string, permission: DeviceOrderPermission) =>
    authorize(event, branchId, [permission], permission === 'orders.read');
}

const db = DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}), {marshallOptions:{removeUndefinedValues:true}});
export const handler = createProductionMerchantOrderResponses({db, authorizeDevice: createDeviceOrderAuthority(db)});
