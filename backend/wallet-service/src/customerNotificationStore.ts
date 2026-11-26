import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
  type TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { WalletError } from './types';

type Guard = NonNullable<TransactWriteCommandInput['TransactItems']>;
type Cursor = { createdAt: string; driverId: string; eventId: string };

const fail = () => new WalletError('تعذر تحديث الإشعار', 'NOTIFICATION_UNAVAILABLE', 403);
const readKey = (subject: string) => ({ idempotencyKey: `CUSTOMER_NOTIFICATION_READ#${subject}`, sk: 'META' });

function readCursor(subject: string, cursor: string | undefined): Cursor | undefined {
  if (!cursor) return undefined;
  try {
    if (cursor.length > 2048) throw Error();
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (value.driverId !== subject ||
        Object.keys(value).sort().join(',') !== 'createdAt,driverId,eventId' ||
        typeof value.eventId !== 'string' || typeof value.createdAt !== 'string') throw Error();
    return value;
  } catch {
    throw new WalletError('مؤشر الصفحة غير صالح', 'INVALID_CURSOR', 400);
  }
}

export function createCustomerNotificationStore({
  db, notificationsTable, readStateTable, writeChecks, now = () => new Date(),
}: {
  db: Pick<DynamoDBDocumentClient, 'send'>;
  notificationsTable: () => string | undefined;
  readStateTable: string;
  writeChecks?: (subject: string) => Guard;
  now?: () => Date;
}) {
  async function list(subject: string, cursor?: string) {
    const table = notificationsTable();
    const start = readCursor(subject, cursor);
    const readState = (await db.send(new GetCommand({
      TableName: readStateTable, Key: readKey(subject), ConsistentRead: true,
    }))).Item;
    const page = await db.send(new QueryCommand({
      TableName: table, IndexName: 'ByDriver', KeyConditionExpression: 'driverId = :subject',
      FilterExpression: 'recipientApp = :app', ExpressionAttributeValues: { ':subject': subject, ':app': 'user' },
      ScanIndexForward: false, Limit: 30, ExclusiveStartKey: start,
    }));
    return {
      notifications: (page.Items || []).map(row => ({
        id: row.eventId, type: row.type, title: row.title, body: row.body, createdAt: row.createdAt,
        readAt: row.readAt || (Date.parse(row.createdAt) <= Date.parse(readState?.readThrough) ? readState?.readThrough : null),
        transferId: row.transferId, amount: row.amount, source: 'server',
        target: row.target || (String(row.type || '').startsWith('wallet') ? 'wallet' : ''),
        orderId: row.orderId, orderNumber: row.orderNumber, campaignId: row.campaignId, sessionId: row.sessionId,
      })),
      nextCursor: page.LastEvaluatedKey ? Buffer.from(JSON.stringify(page.LastEvaluatedKey)).toString('base64url') : null,
    };
  }

  async function markAll(subject: string, at: string) {
    const update = {
      TableName: readStateTable, Key: readKey(subject), UpdateExpression: 'SET readThrough = :now',
      ConditionExpression: 'attribute_not_exists(readThrough) OR readThrough <= :now',
      ExpressionAttributeValues: { ':now': at },
    };
    const checks = writeChecks?.(subject);
    try {
      if (checks) {
        await db.send(new TransactWriteCommand({
          TransactItems: [...checks, { Update: update }],
        }));
      } else {
        await db.send(new UpdateCommand(update));
      }
    } catch (error: any) {
      if (!checks && error.name === 'ConditionalCheckFailedException') return;
      if (checks && error.name === 'TransactionCanceledException') {
        const reasons = error.CancellationReasons;
        if (reasons?.length === checks.length + 1 &&
            reasons.slice(0, checks.length).every((reason: { Code: string }) => reason.Code === 'None') &&
            reasons[checks.length].Code === 'ConditionalCheckFailed') return;
        throw fail();
      }
      throw error;
    }
  }

  async function markRead(subject: string, input: { all?: unknown; eventIds?: unknown }) {
    const table = notificationsTable();
    const at = now().toISOString();
    if (input.all === true) {
      await markAll(subject, at);
      return { read: true };
    }
    if (!Array.isArray(input.eventIds) || input.eventIds.length < 1 || input.eventIds.length > 50 ||
        input.eventIds.some(id => typeof id !== 'string' || id.length > 250 || !id)) {
      throw new WalletError('اختر إشعارات صالحة', 'INVALID_NOTIFICATION', 400);
    }
    const ids = [...new Set<string>(input.eventIds)];
    try {
      await db.send(new TransactWriteCommand({
        TransactItems: [
          ...(writeChecks?.(subject) || []),
          ...ids.map(eventId => ({ Update: {
            TableName: table, Key: { eventId }, UpdateExpression: 'SET readAt = if_not_exists(readAt, :now)',
            ConditionExpression: 'attribute_exists(eventId) AND driverId = :subject AND recipientApp = :app',
            ExpressionAttributeValues: { ':now': at, ':subject': subject, ':app': 'user' },
          } })),
        ],
      }));
    } catch (error: any) {
      if (error.name === 'TransactionCanceledException') throw fail();
      throw error;
    }
    return { read: true };
  }

  return { list, markRead };
}
