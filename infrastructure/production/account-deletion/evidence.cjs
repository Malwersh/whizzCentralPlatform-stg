'use strict';

const { GetCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { blockers, error, target } = require('../../../backend/account-deletion/policy');
const cod = require('../../../backend/account-deletion/cod-retention');
const benefits = require('../../../backend/account-deletion/customer-benefit-inventory');
const funding = require('../../../backend/account-deletion/customer-delivery-funding-inventory');
const { settledCorrectionPosition } = require('../../../backend/staff-service/merchant-ownership-preflight');

const { customerProfileAssetFields } = require('./customer-profile-fields.cjs');

const production = name => 'wizz-production-' + name;
const tables = Object.freeze(Object.fromEntries(Object.entries({
  customer: 'Customers', driver: 'Drivers', branches: 'Merchants', platform: 'MerchantPlatform',
  wallets: 'Wallets', orders: 'Orders', holds: 'Holds', transfers: 'IdempotencyKeys', topups: 'TopupRequests',
  events: 'WalletLifecycle', dispatch: 'DispatchJobs', offers: 'WaveOffers', deletion: 'AccountDeletion',
  journeys: 'OfferJourney', staff: 'PlatformStaff',
  supportSessions: 'SupportChatSessions', supportAttachments: 'SupportAttachments',
}).map(([key, name]) => [key, production(name)])));
const terminalOrders = new Set([
  'returned', 'delivered', 'completed', 'rejected', 'refunded', 'expired', 'cancelled', 'canceled',
  ...['user', 'customer', 'restaurant', 'store', 'driver', 'system'].map(role => 'canceled_by_' + role),
]);
const terminalPayments = new Set(['COMPLETED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED', 'CANCELED']);
const terminalPayouts = new Set(['COMPLETED', 'PAID', 'REJECTED', 'CANCELLED', 'CANCELED', 'EXPIRED', 'FAILED', 'FAILED_NOT_PAID']);
const actors = new Set(['CUSTOMER', 'DRIVER', 'MERCHANT']);
function emptyEvidence() {
  return { complete: true, wallets: [], activeOrders: [], activeHolds: [], pendingTransfers: [], pendingPayments: [] };
}

function createEvidence({ db, maxPages = 100, deliveryFundingArchiveEnabled = false, clock = Date.now }) {
  const get = async (TableName, Key) => (await db.send(new GetCommand({ TableName, Key, ConsistentRead: true }))).Item;
  async function scan(TableName, match, ids) {
    if (!ids.length) return [];
    if (ids.length > 100) {
      const wanted=new Set(ids);
      const rows=await readPages(ScanCommand,{TableName,ConsistentRead:true,Limit:500});
      return rows.filter(row=>match.some(field=>wanted.has(row[field])));
    }
    const fields = Object.fromEntries(match.map((field, index) => ['#field' + index, field]));
    const values = Object.fromEntries(ids.map((id, index) => [':id' + index, id]));
    const markers = Object.keys(values).join(',');
    const filters = Object.keys(fields).map(name => name + ' IN (' + markers + ')');
    const selected = await readPages(ScanCommand, { TableName, ConsistentRead: true, Limit: 500,
      ExpressionAttributeNames: fields, ExpressionAttributeValues: values, FilterExpression: filters.join(' OR ') });
    if (selected.some(row => !match.some(field => ids.includes(row[field])))) throw error('OWNERSHIP_MISMATCH');
    return selected;
  }
  async function readPages(Command, options) {
    const rows = [];
    let cursor;
    for (let count = 0; count < maxPages; count++) {
      const page = await db.send(new Command({ ...options, ExclusiveStartKey: cursor }));
      rows.push(...(page.Items || []));
      cursor = page.LastEvaluatedKey;
      if (!cursor) return rows;
    }
    throw error('EVIDENCE_INCOMPLETE');
  }
  const partition = pk => readPages(QueryCommand, {
    TableName: tables.platform, ConsistentRead: true, KeyConditionExpression: 'pk=:pk',
    ExpressionAttributeValues: { ':pk': pk },
  });

  async function supportRetentionReview(subjectId) {
    const sessions = (await scan(tables.supportSessions, ['customerId','userId'], [subjectId]))
      .filter(row => row.userType==='customer' || row.customerId===subjectId);
    if(sessions.some(row=>row.userType!=='customer'||row.customerId!==subjectId||
        row.userId!==subjectId||typeof row.sessionId!=='string'||!row.sessionId))throw error('OWNERSHIP_MISMATCH');
    const attachments = await scan(tables.supportAttachments, ['sessionId'], sessions.map(row=>row.sessionId));
    return [...sessions,...attachments].some(row=>Boolean(row.legalHold||row.retentionHold||row.evidenceRetention||row.complaintCaseId));
  }

  async function moneyAndWork(type, ownerId, orders) {
    const walletId = 'WALLET#' + type + '#' + ownerId;
    const orderIds = [...new Set(orders.map(row => row.orderId))];
    if (orderIds.some(id => typeof id !== 'string' || !id)) throw error('EVIDENCE_INCOMPLETE');
    const codFields = { [tables.events]: ['orderId','branchId','driverId','subjectId'],
      [tables.dispatch]: ['orderId','branchId','driverId','subjectId'],
      [tables.holds]: ['orderId','branchId','driverId','subjectId','customerId'] };
    const codIds = [...new Set([...orderIds, ownerId])];
    const customerQueries=type==='CUSTOMER'?[
      benefits.inventory({db,subjectIds:[ownerId],orderIds,maxPages,table:tables.journeys}),
      funding.inventory({db,subjectIds:[ownerId],maxPages,table:tables.staff}),
    ]:[];
    const [wallet, holds, topups, transfers, pendingCod, ...customerInventories] = await Promise.all([
      get(tables.wallets, { walletId, sk:'META' }),
      scan(tables.holds, ['walletId'], [walletId]),
      scan(tables.topups, ['walletId'], [walletId]),
      scan(tables.transfers, ['sourceWalletId','recipientWalletId'], [walletId]),
      cod.pendingCod({
        db, customerIds: type==='CUSTOMER'?[ownerId]:[], driverIds: type==='DRIVER'?[ownerId]:[],
        branchId: type==='MERCHANT'?ownerId:undefined, orderIds,
        tables, readRows: table => scan(table, codFields[table], codIds),
      }),
      ...customerQueries,
    ]);
    if (wallet && (wallet.walletId!==walletId || wallet.ownerType!==type || wallet.ownerId!==ownerId ||
        wallet.currency!=='IQD' || !Number.isSafeInteger(wallet.availableBalance) || !Number.isSafeInteger(wallet.lockedBalance) ||
        !Number.isSafeInteger(wallet.version) || wallet.version < 1)) throw error('EVIDENCE_UNAVAILABLE');
    const deliveryFunding = type === 'CUSTOMER' ? customerInventories[1] : undefined;
    if (deliveryFundingArchiveEnabled && deliveryFunding?.records &&
        deliveryFunding.blockers.every(item => item.code === 'DELIVERY_FUNDING_RETENTION_REVIEW')) {
      await require('../../../backend/account-deletion/customer-delivery-funding-archive').validateSources({
        db, subjectIds: [ownerId], sourceKeys: deliveryFunding.keys, environment: 'production',
      });
      deliveryFunding.blockers = [];
    }
    const chargeHolds = holds.filter(row => ['ACTIVE','LOCKED_PENDING_SETTLEMENT','CLAIMED_FOR_SETTLEMENT'].includes(row.status));
    return {
      ...emptyEvidence(), walletIds:[walletId],
      wallets:wallet?[{ walletId, ownerId, source:'CORE', version:wallet.version,
        available:wallet.availableBalance, locked:wallet.lockedBalance }]:[],
      activeOrders:orders.filter(row => !terminalOrders.has(String(row.status||'').toLowerCase())).map(row=>({orderId:row.orderId,status:row.status})),
      activeHolds:chargeHolds.map(row=>({orderId:row.orderId,status:row.status})),
      pendingTransfers:transfers.filter(row=>row.transferId&&!terminalPayments.has(row.status)).map(row=>({transferId:row.transferId,status:row.status})),
      pendingPayments:[...pendingCod,...customerInventories.flatMap(r=>r.blockers.map(row=>({status:row.code}))),
        ...topups.filter(row=>!terminalPayments.has(row.status)).map(row=>({topupId:row.topupId,status:row.status}))],
    };
  }

  async function merchantBranch(actor, scope, branch) {
    const { id } = scope;
    if (!branch || branch.businessId !== id || branch.isDeleted || branch.deletedAt) throw error('BUSINESS_NOT_FOUND');
    if (!branch.ownerId || branch.ownerId !== branch.cognitoUserId) throw error('OWNERSHIP_MISMATCH');
    if (scope.kind==='MEMBERSHIP') {
      if (branch.ownerId===actor.sub) throw error('OWNERSHIP_TRANSFER_REQUIRED');
      const row=await get(tables.platform,{pk:'BRANCH#'+id,sk:'MEMBER#'+actor.sub});
      if(row?.subjectId!==actor.sub||row.ownerId!==branch.ownerId||row.businessId!==id||row.status!=='ACTIVE') throw error('MEMBERSHIP_REQUIRED');
      if(!Number.isSafeInteger(row.version)||row.version<1) throw error('EVIDENCE_UNAVAILABLE');
      return {...emptyEvidence(),isOwner:false,isMember:true,membership:{ownerId:row.ownerId,version:row.version}};
    }
    if (branch.ownerId!==actor.sub) throw error('OWNER_REQUIRED');
    const [orders,payouts,corrections] = await Promise.all([
      scan(tables.orders,['storeId','businessId','restaurantId'],[id]),
      partition('MERCHANT_PAYOUT#'+id), partition('MERCHANT_CORRECTIONS#'+id),
    ]);
    const evidence = await moneyAndWork('MERCHANT', id, orders);
    if (payouts.some(row=>row.kind==='MERCHANT_PAYOUT'&&!terminalPayouts.has(row.status))) {
      evidence.pendingPayments.push({status:'PAYOUT_PENDING'});
    }
    if (corrections.some(row=>row.sk==='POSITION'&&(row.kind!=='MERCHANT_CORRECTION_POSITION'||
        row.branchId!==id||row.ownerId!==actor.sub||!settledCorrectionPosition(row))||
        row.status==='PENDING_APPROVAL'||row.kind==='MERCHANT_CORRECTION_RESERVATION'&&row.status==='ACTIVE')) {
      evidence.pendingPayments.push({status:'CORRECTION_PENDING'});
    }
    const transferExpiresAt=branch.orderIntakeTransferExpiresAt;
    if (transferExpiresAt!==undefined && !(Number.isSafeInteger(transferExpiresAt) && transferExpiresAt<=clock())) {
      evidence.ownershipTransferReview=true;
    }
    if (branch.legalHold || branch.retentionHold) evidence.profileRetentionReview=true;
    return {...evidence,isOwner:true};
  }

  return async (actor, requested, { preview=false }={}) => {
    if (!actors.has(actor?.type) || !/^[a-f0-9-]{36}$/i.test(actor.sub||'')) throw error('UNAUTHORIZED');
    const scope = target(actor, requested);
    if (actor.type==='MERCHANT') {
      if(scope.kind!=='ACCOUNT') return merchantBranch(actor,scope,await get(tables.branches,{businessId:scope.id}));
      const [owned,person] = await Promise.all([
        scan(tables.branches,['ownerId','cognitoUserId'],[actor.sub]),
        get(tables.platform,{pk:'PERSON#'+actor.sub,sk:'PROFILE'}),
      ]);
      if (person&&person.subjectId!==actor.sub) throw error('OWNERSHIP_MISMATCH');
      if (owned.some(row=>row.ownerId!==actor.sub||row.cognitoUserId!==actor.sub)) throw error('OWNERSHIP_MISMATCH');
      const active=owned.filter(row=>!row.deletedAt&&!row.isDeleted);
      const evidence={...emptyEvidence(),ownedBusinesses:active.map(row=>row.businessId)};
      if (person?.legalHold || person?.retentionHold) evidence.profileRetentionReview=true;
      if(preview){
        evidence.businesses=[];
        for(const branch of active){
          const branchScope={kind:'BUSINESS',id:branch.businessId,type:actor.type};
          const details=await merchantBranch(actor,branchScope,branch);
          evidence.businesses.push({businessId:branch.businessId,
            name:branch.businessName||branch.name||branch.branchName||branch.businessId,
            blockers:blockers(actor,branchScope,details)});
        }
      }
      return evidence;
    }
    const driver = actor.type==='DRIVER';
    const profileKey=driver?'driverId':'userId';
    const profile=await get(driver?tables.driver:tables.customer,{[profileKey]:actor.sub});
    if (profile && (profile[profileKey]!==actor.sub ||
        (!driver || profile.cognitoSub!==undefined) && profile.cognitoSub!==actor.sub)) {
      throw error('OWNERSHIP_MISMATCH');
    }
    const orders = await scan(tables.orders,driver?['driverId','assignedDriverId']:['userSub','customerId','userId'],[actor.sub]);
    if (driver) {
      const offers = (await scan(tables.offers,['driverId'],[actor.sub])).filter(cod.isAccepted);
      const newOrderIds = [...new Set(offers.map(row=>row.orderId))].filter(id=>!orders.some(row=>row.orderId===id));
      if(newOrderIds.length){
        const prior=await scan(tables.orders,['orderId'],newOrderIds);
        if(newOrderIds.some(id=>!prior.some(row=>row.orderId===id))) throw error('EVIDENCE_INCOMPLETE');
        orders.push(...prior);
      }
    }
    const driverWork = driver ? Promise.all([
      readPages(QueryCommand, {
        TableName: tables.deletion, ConsistentRead: true,
        KeyConditionExpression: 'pk=:pk',
        ExpressionAttributeValues: { ':pk': 'ACCOUNT_OPERATION#DRIVER#' + actor.sub },
      }),
      get(tables.transfers, { idempotencyKey: 'ZC#ACTIVE#' + actor.sub, sk: 'META' }),
    ]) : Promise.resolve([[], undefined]);
    const [facts,hold,[operations,gateway]] = await Promise.all([
      moneyAndWork(actor.type,actor.sub,orders), driver?false:supportRetentionReview(actor.sub), driverWork,
    ]);
    if (operations.some(operation => operation.pk !== 'ACCOUNT_OPERATION#DRIVER#' + actor.sub ||
        operation.subjectId !== actor.sub || !Number.isSafeInteger(operation.expiresAt))) {
      throw error('EVIDENCE_INCOMPLETE');
    }
    const pendingReviews = driver ? facts.pendingPayments.filter(item => item.status?.startsWith('QUALITY_')) : [];
    const pendingPayments = facts.pendingPayments.filter(item => !pendingReviews.includes(item));
    if (gateway?.requestId) pendingPayments.push({ status:'ZAINCASH_PAYMENT_PENDING' });
    for (const operation of operations) {
      if (operation.expiresAt > Math.floor(clock()/1000)) {
        pendingPayments.push({ status:operation.kind === 'FUNDING_RECEIPT' ? 'RECEIPT_UPLOAD_PENDING' : 'DOCUMENT_UPLOAD_PENDING' });
      }
    }
    const profileHeld = Boolean(profile?.legalHold || profile?.retentionHold);
    const externalAssets = !driver && profile && customerProfileAssetFields.some(field => profile[field])
      ? [{ kind: 'CUSTOMER_PROFILE_ASSET' }] : [];
    return { ...facts, pendingPayments, pendingReviews, profileIds: profile ? [actor.sub] : [], externalAssets,
      supportRetentionReview: hold, profileRetentionReview: profileHeld };
  };
}

module.exports = { createEvidence, tables, terminalOrders };
