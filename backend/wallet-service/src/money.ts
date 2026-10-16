/** IQD arithmetic contract for new financial flows. No persistence or legacy inference. */
export interface Money {
  readonly currency: 'IQD';
  readonly scale: 1000;
  readonly moneySchemaVersion: 1;
  readonly minorAmount: number;
}

export type MoneyErrorCode = 'INVALID_MONEY' | 'UNSUPPORTED_MONEY_SCHEMA' | 'MONEY_OVERFLOW' | 'PRECISION_LOSS' | 'INVALID_ROUNDING';
export class MoneyError extends Error {
  constructor(public readonly code: MoneyErrorCode) {
    super(code);
    this.name = 'MoneyError';
  }
}

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
function integer(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new MoneyError('INVALID_MONEY');
  return value;
}
function bounded(value: bigint): number {
  if (value > MAX || value < -MAX) throw new MoneyError('MONEY_OVERFLOW');
  return Number(value);
}
export function moneyFromMinor(minorAmount: number): Money {
  return Object.freeze({ currency: 'IQD', scale: 1000, moneySchemaVersion: 1, minorAmount: integer(minorAmount) === 0 ? 0 : minorAmount });
}
/** Decode the money value itself, not an entire order/wallet. Missing markers never default. */
export function readMoney(value: unknown): Money {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new MoneyError('INVALID_MONEY');
  const row = value as Record<string, unknown>;
  if (row.currency !== 'IQD' || row.scale !== 1000 || row.moneySchemaVersion !== 1) throw new MoneyError('UNSUPPORTED_MONEY_SCHEMA');
  if (Object.keys(row).some(key => !['currency', 'scale', 'moneySchemaVersion', 'minorAmount'].includes(key))) throw new MoneyError('INVALID_MONEY');
  return moneyFromMinor(integer(row.minorAmount));
}
/** Decimal boundary uses ASCII text, never binary fractional numbers, separators or exponents. */
export function parseIqd(text: string): Money {
  if (typeof text !== 'string' || text.length > 24 || !/^-?(0|[1-9]\d*)(\.\d{1,3})?$/.test(text)) throw new MoneyError('INVALID_MONEY');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const amount = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return moneyFromMinor(bounded(negative ? -amount : amount));
}
export function formatIqd(value: Money): string {
  const amount = BigInt(readMoney(value).minorAmount);
  const absolute = amount < 0n ? -amount : amount;
  const fraction = String(absolute % 1000n).padStart(3, '0').replace(/0+$/, '');
  return `${amount < 0n ? '-' : ''}${absolute / 1000n}${fraction ? '.' + fraction : ''}`;
}
/** Only call after the caller has established that its source contract is whole IQD. */
export function fromWholeIqd(amount: number): Money {
  return moneyFromMinor(bounded(BigInt(integer(amount)) * 1000n));
}
/** Never silently round new fractional IQD into the current whole-IQD wallet schema. */
export function toWholeIqdExact(value: Money): number {
  const amount = readMoney(value).minorAmount;
  if (amount % 1000 !== 0) throw new MoneyError('PRECISION_LOSS');
  return amount / 1000;
}
export function addMoney(...values: Money[]): Money {
  return moneyFromMinor(bounded(values.reduce((sum, value) => sum + BigInt(readMoney(value).minorAmount), 0n)));
}
export function subtractMoney(left: Money, right: Money): Money {
  return moneyFromMinor(bounded(BigInt(readMoney(left).minorAmount) - BigInt(readMoney(right).minorAmount)));
}
export type MoneyRounding = 'EXACT' | 'TOWARD_ZERO' | 'HALF_AWAY_FROM_ZERO';
/** Rate is an integer rational (e.g. 125/10000). Rounding must be explicitly selected. */
export function multiplyMoney(value: Money, numerator: number, denominator: number, rounding: MoneyRounding): Money {
  const amount = BigInt(readMoney(value).minorAmount);
  if (integer(numerator) < 0 || integer(denominator) <= 0) throw new MoneyError('INVALID_MONEY');
  if (!['EXACT', 'TOWARD_ZERO', 'HALF_AWAY_FROM_ZERO'].includes(rounding)) throw new MoneyError('INVALID_ROUNDING');
  const product = amount * BigInt(numerator), divisor = BigInt(denominator);
  let quotient = product / divisor;
  const remainder = product % divisor;
  if (remainder !== 0n) {
    if (rounding === 'EXACT') throw new MoneyError('PRECISION_LOSS');
    const absolute = remainder < 0n ? -remainder : remainder;
    if (rounding === 'HALF_AWAY_FROM_ZERO' && absolute * 2n >= divisor) quotient += product < 0n ? -1n : 1n;
  }
  return moneyFromMinor(bounded(quotient));
}
