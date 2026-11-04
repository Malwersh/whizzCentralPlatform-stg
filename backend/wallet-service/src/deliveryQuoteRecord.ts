import { createHash } from 'node:crypto';
import { readMoney } from './money';
export const QUOTE_TABLE = 'staging-DeliveryQuotes';
export const CUSTOMER_PROFILE_TABLE = 'WizzUser_users_staging';
export const quoteIdValid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export const quoteEntityIdValid = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(v);
export function quoteCanonical(v: any): string {
  return Array.isArray(v) ? '[' + v.map(quoteCanonical).join(',') + ']' : v && typeof v === 'object' ?
    '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + quoteCanonical(v[k])).join(',') + '}' : JSON.stringify(v);
}
export const quoteHash = (v: unknown) => createHash('sha256').update(quoteCanonical(v)).digest('hex');
export const quoteReferenceTables = new Set(['WhizzMerchants_Businesses', 'WizzUser_addresses_staging', 'staging-PlatformStaff',
  'staging-MerchantPlatform', 'staging-AccountDeletion', 'WizzCentral_Regions', 'WizzCentral_RegionsDerived_staging']);
/** Internal database integrity check; a digest is not a client authorization token or a signature. */
export function validDeliveryQuoteRecord(row: Record<string, any>): boolean {
  try {
    const { digest, consumption: _consumption, legalHold: _legalHold, retentionHold: _retentionHold, ...content } = row;
    const created = Date.parse(row.createdAt), expires = Date.parse(row.expiresAt);
    const fee = readMoney(row.calculation?.customerDeliveryFee);
    return row.schemaVersion === 1 && quoteIdValid(row.requestId) && quoteEntityIdValid(row.branchId) && quoteEntityIdValid(row.addressId) &&
      typeof digest === 'string' && digest === quoteHash(content) && fee.minorAmount >= 0 &&
      Number.isFinite(created) && Number.isFinite(expires) && created < expires && expires - created <= 120000 &&
      Array.isArray(row.fences) && row.fences.length > 0 && row.fences.length <= 90 &&
      row.fences.every((f: any) => f && quoteReferenceTables.has(f.TableName) && f.Key && typeof f.ConditionExpression === 'string') &&
      Buffer.byteLength(JSON.stringify(row)) <= 320000;
  } catch { return false; }
}
