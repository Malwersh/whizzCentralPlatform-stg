import { DynamoDBDocumentClient, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { FinancialRow as Row } from './driverFinancialTransaction';

const { historyFilter, terminal, tripWithSettlement } = require('../../shared/production-driver-trip-history');
const orders = 'wizz-production-Orders';
const holds = 'wizz-production-Holds';
const orderKey = /^ORDER#[A-Za-z0-9_-]{1,120}$/;

export async function productionDriverHistory(
  db: Pick<DynamoDBDocumentClient, 'send'>,
  driverId: string,
  query: Record<string, string | undefined>,
  orderId?: string,
) {
  const readSettlement = async (id: string, sk: string) => (await db.send(new GetCommand({
    TableName: holds, Key: {orderId:id, sk}, ConsistentRead: true,
  }))).Item;
  const isOwnTerminal = (order: Row | undefined): order is Row =>
    !!order && order.SK === 'META' && order.driverId === driverId && terminal.includes(order.status);
  if (orderId !== undefined) {
    if (!orderKey.test('ORDER#' + orderId)) return {status:404, data:{success:false, code:'TRIP_UNAVAILABLE'}};
    const {Item} = await db.send(new GetCommand({
      TableName:orders, Key:{PK:'ORDER#'+orderId,SK:'META'}, ConsistentRead:true,
    }));
    if (!isOwnTerminal(Item)) return {status:404, data:{success:false, code:'TRIP_UNAVAILABLE'}};
    return {status:200, data:{success:true, trip:await tripWithSettlement(Item,readSettlement)}};
  }

  let cursor: Row | undefined;
  let filter: Row;
  const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit ?? '', 10) || 20));
  try {
    if (query.status && !['completed','cancelled','returned'].includes(query.status)) throw Error('INVALID_STATUS');
    filter = historyFilter(query, driverId);
    if (query.nextToken) {
      if (query.nextToken.length > 1000) throw Error('INVALID_CURSOR');
      const key = JSON.parse(Buffer.from(query.nextToken,'base64url').toString('utf8'));
      if (typeof key?.PK !== 'string' || !orderKey.test(key.PK) ||
          typeof key.SK !== 'string' || !key.SK || key.SK.length > 1024) throw Error('INVALID_CURSOR');
      cursor = {PK:key.PK,SK:key.SK};
    }
  } catch {
    return {status:400, data:{success:false, code:'INVALID_HISTORY_FILTER'}};
  }

  const matches: Row[] = [];
  for (let page=0; page<20; page++) {
    const result = await db.send(new ScanCommand({
      TableName:orders, ConsistentRead:true, ExclusiveStartKey:cursor,
      Limit:limit-matches.length,
      FilterExpression:filter.FilterExpression,
      ExpressionAttributeNames:filter.ExpressionAttributeNames,
      ExpressionAttributeValues:filter.ExpressionAttributeValues,
    }));
    matches.push(...(result.Items ?? []).filter(isOwnTerminal));
    cursor = result.LastEvaluatedKey;
    if (!cursor || matches.length >= limit) break;
  }
  const trips = [];
  for (let offset=0; offset<matches.length; offset+=4) {
    trips.push(...await Promise.all(matches.slice(offset, offset+4).map(order=>tripWithSettlement(order,readSettlement))));
  }
  return {status:200, data:{success:true,trips,count:trips.length,hasMore:!!cursor,
    nextToken:cursor?Buffer.from(JSON.stringify(cursor)).toString('base64url'):null}};
}
