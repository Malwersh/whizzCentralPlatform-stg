import { quoteHash } from './deliveryQuoteRecord';

export type MerchantSettlementSchedule = {
  schemaVersion: 1; version: number; timezone: 'Asia/Baghdad';
  frequency: 'WEEKLY' | 'FORTNIGHTLY' | 'MONTHLY'; anchorLocalDate: string;
};
const DAY = 86400000;
const fail = (): never => { throw Error('INVALID_MERCHANT_SETTLEMENT_PERIOD'); };
const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit',
  day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
function parts(at: number) {
  return Object.fromEntries(local.formatToParts(new Date(at)).filter(p => p.type !== 'literal').map(p => [p.type, Number(p.value)]));
}
function day(value: string): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail();
  const time = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value || Number(value.slice(0, 4)) < 2000) return fail();
  return time / DAY;
}
function date(value: number): string { return new Date(value * DAY).toISOString().slice(0, 10); }
function midnight(value: number): string {
  const guess = value * DAY, p = parts(guess);
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - guess;
  const at = guess - offset, checked = parts(at);
  if (Date.UTC(checked.year, checked.month - 1, checked.day) / DAY !== value || checked.hour || checked.minute || checked.second) return fail();
  return new Date(at).toISOString();
}

/** Calendar boundaries only; not batch membership, payable eligibility or payout
 * authorization. Caller must pin the schedule version and account for late events
 * and agreement effective dates when building a statement.
 */
export function merchantSettlementPeriod(schedule: MerchantSettlementSchedule, at: string) {
  if (!schedule || Object.keys(schedule).sort().join(',') !== 'anchorLocalDate,frequency,schemaVersion,timezone,version' ||
      schedule.schemaVersion !== 1 || !Number.isSafeInteger(schedule.version) || schedule.version < 1 ||
      schedule.timezone !== 'Asia/Baghdad' || !['WEEKLY', 'FORTNIGHTLY', 'MONTHLY'].includes(schedule.frequency) ||
      typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) return fail();
  const anchor = day(schedule.anchorLocalDate), p = parts(Date.parse(at));
  const current = Date.UTC(p.year, p.month - 1, p.day) / DAY;
  let start: number, end: number;
  if (schedule.frequency === 'MONTHLY') {
    const anchorDay = Number(schedule.anchorLocalDate.slice(8));
    const boundary = (month: number) => {
      const daysInMonth = new Date(Date.UTC(p.year, month + 1, 0)).getUTCDate();
      return Date.UTC(p.year, month, Math.min(anchorDay, daysInMonth)) / DAY;
    };
    let month = p.month - 1;
    if (current < boundary(month)) month--;
    start = boundary(month); end = boundary(month + 1);
  } else {
    const length = schedule.frequency === 'WEEKLY' ? 7 : 14;
    start = anchor + Math.floor((current - anchor) / length) * length;
    end = start + length;
  }
  const from = midnight(start), until = midnight(end);
  if (!(from <= at && at < until)) return fail();
  const content = { schemaVersion: 1, scheduleVersion: schedule.version, scheduleDigest: quoteHash(schedule),
    timezone: schedule.timezone, frequency: schedule.frequency, anchorLocalDate: schedule.anchorLocalDate,
    startLocalDate: date(start), endExclusiveLocalDate: date(end), fromUtc: from, untilExclusiveUtc: until,
    boundaryRule: 'START_INCLUSIVE_END_EXCLUSIVE', monthEndRule: 'CLAMP_TO_MONTH_END_PRESERVE_ORIGINAL_ANCHOR_DAY' };
  return { ...content, periodId: 'MSP:' + quoteHash(content).slice(0, 48) };
}
