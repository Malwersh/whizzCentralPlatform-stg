import {quoteHash} from './deliveryQuoteRecord';
type Row = Record<string, any>;
const fields = ['pk','sk','kind','schemaVersion','version','orderId','status','requestDigest','fundingDigest','sourceDigest','closedAt','digest'];
/** Minimal immutable replay proof. Contains no customer identifier or allocation.
 * Writing this marker requires the expiry worker's independent closure checks;
 * this reader grants no authority to compact or delete financial evidence. */
export function readDeliveryFundingReplay(row: Row, key: Row, orderId: string): Row | null {
  if (row.kind !== 'DELIVERY_FUNDING_REPLAY') return null;
  const invalid = () => { throw new Error('DELIVERY_REPLAY_PROOF_INVALID'); };
  if (Object.keys(row).sort().join(',') !== [...fields].sort().join(',') ||
      row.schemaVersion !== 1 || !Number.isSafeInteger(row.version) || row.version < 1 ||
      row.pk !== key.pk || row.sk !== key.sk || row.orderId !== orderId ||
      !['DELIVERY_RESERVATION#'+orderId,'DELIVERY_RESERVATION#'+orderId+'#PROMOTION'].includes(key.pk) || key.sk !== 'META' ||
      !['CAPTURED','RELEASED'].includes(row.status) || typeof row.closedAt !== 'string' || !Number.isFinite(Date.parse(row.closedAt))) invalid();
  for (const field of ['requestDigest','fundingDigest','sourceDigest','digest'])
    if (typeof row[field] !== 'string' || !/^[a-f0-9]{64}$/.test(row[field])) invalid();
  const {digest, ...body} = row;
  if (quoteHash(body) !== digest) invalid();
  return row;
}
export function deliveryFundingReplayFence(row: Row) {
  return {ConditionCheck:{TableName:'staging-PlatformStaff',Key:{pk:row.pk,sk:row.sk},
    ConditionExpression:'#kind=:kind AND #version=:version AND #digest=:digest',
    ExpressionAttributeNames:{'#kind':'kind','#version':'version','#digest':'digest'},
    ExpressionAttributeValues:{':kind':row.kind,':version':row.version,':digest':row.digest}}};
}
