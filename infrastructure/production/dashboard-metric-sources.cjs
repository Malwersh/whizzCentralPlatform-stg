'use strict';

const {normalizeDiscount, normalizePlatformPromo, validShape} = require('../../backend/staff-service/discount-engine');
const {removed, supported} = require('../../backend/staff-service/discount-contract');

const revenueAccounts = new Set([
  'MERCHANT_COMMISSION_REVENUE',
  'SERVICE_FEE_REVENUE',
  'PLATFORM_OTHER_REVENUE',
  'BASE_DELIVERY_MARGIN_REVENUE',
  'CASH_ROUNDING_SERVICE_ADJUSTMENT',
]);

function activeOffer(row, source, at) {
  try {
    const offer = source === 'platform' ? normalizePlatformPromo(row) : normalizeDiscount(row);
    const active = offer.status === 'active' ||
      (source === 'platform' && offer.status === undefined && offer.isActive === true);
    return active && offer.isActive !== false && offer.sharedStopped !== true && !removed(offer) &&
      supported(offer) && validShape(offer, 0) &&
      (offer.usageLimit === null || offer.usageCount < offer.usageLimit) &&
      typeof offer.validFrom === 'string' && Date.parse(offer.validFrom) <= at &&
      typeof offer.validTo === 'string' && at < Date.parse(offer.validTo);
  } catch {
    return false;
  }
}

function revenueMinor(row) {
  if (!Array.isArray(row.lines) || !row.lines.length) throw Error('Invalid journal lines');
  let revenue = 0n;
  for (const line of row.lines) {
    if (!revenueAccounts.has(line.account)) continue;
    const amount = line.amount;
    if ((line.side !== 'CREDIT' && line.side !== 'DEBIT') || amount?.currency !== 'IQD' ||
        amount.scale !== 1000 || amount.moneySchemaVersion !== 1 ||
        !Number.isSafeInteger(amount.minorAmount) || amount.minorAmount < 0) throw Error('Invalid journal money');
    const minor = BigInt(amount.minorAmount);
    revenue += line.side === 'CREDIT' ? minor : -minor;
  }
  return revenue;
}

function additionalMetrics(at, start, end) {
  const offer = (TableName, source) => ({
    query: {TableName},
    accumulate: row => activeOffer(row, source, at) ? 1n : 0n,
  });
  return {
    support: [{
      query: {
        TableName: 'wizz-production-SupportChatSessions',
        FilterExpression: '#status IN (:waiting, :active)',
        ExpressionAttributeNames: {'#status': 'status'},
        ExpressionAttributeValues: {':waiting': 'waiting_for_agent', ':active': 'active'},
      },
    }],
    offers: [
      offer('wizz-production-PlatformDiscounts', 'platform'),
      offer('wizz-production-MerchantDiscounts', 'merchant'),
    ],
    revenue: [{
      query: {
        TableName: 'wizz-production-MerchantPlatform',
        Select: 'SPECIFIC_ATTRIBUTES',
        FilterExpression: 'begins_with(pk, :prefix) AND sk = :meta AND #kind = :kind AND #status = :posted AND ' +
          'schemaVersion = :version AND settlementModel = :model AND createdAt >= :start AND createdAt < :end',
        ProjectionExpression: '#lines',
        ExpressionAttributeNames: {'#status': 'status', '#kind': 'kind', '#lines': 'lines'},
        ExpressionAttributeValues: {
          ':prefix': 'FULL_CASH_JOURNAL#', ':meta': 'META', ':kind': 'FULL_CASH_ACCOUNTING_JOURNAL',
          ':posted': 'POSTED', ':version': 1, ':model': 'FULL_CASH_AT_DELIVERY_V1', ':start': start, ':end': end,
        },
      },
      accumulate: revenueMinor,
    }],
  };
}

module.exports = {additionalMetrics};
