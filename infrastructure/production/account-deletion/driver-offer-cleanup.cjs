'use strict';

const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables, terminalOrders } = require('./evidence.cjs');
const { legacyAcceptedOffer, legacyDriverSettlementGuards } = require('./driver-legacy-settlement.cjs');
const { closedExceptionGuards } = require('./customer-order-archive.cjs');

const privateFields = ['financialOffer','acceptedTerms','legacyPresentation','driverLocation','driverPosition',
  'driverLatitude','driverLongitude','driverName','driverPhone','driverEmail'];

const inactiveResponses=new Set(['expired','rejected','order_assigned_to_other','financial_expired','financial_declined']);
const inactiveOffer=row=>inactiveResponses.has(row.responseStatus) && row.isWinner===false &&
  !row.acceptedAt && !row.acceptedTerms && row.dispatchReceipt?.success!==true && row.financialReceipt?.success!==true;

function createDriverOfferCleanup({readMerchantAccrualEvidence,preserveMerchantSettlementEvidence,verifyZeroMerchantException}) {
  const get=async (db,TableName,Key)=>
    (await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
  async function inventory({db,request,maxPages}) {
    const {subjectId}=request;
    const offers=[];
    let cursor,pages=0;
    do {
      const response=await db.send(new ScanCommand({
        TableName:tables.offers,ConsistentRead:true,Limit:250,ExclusiveStartKey:cursor,
        FilterExpression:'driverId=:driver OR driverSubjectId=:driver',
        ExpressionAttributeValues:{':driver':subjectId},
      }));
      for (const row of response.Items??[]) {
        if (typeof row.orderId!=='string'||!/^[A-Za-z0-9_.:-]{1,150}$/.test(row.orderId)||
            typeof row.SK!=='string'||!row.SK||
            ![row.driverId,row.driverSubjectId].includes(subjectId)||
            [row.driverId,row.driverSubjectId].some(id=>id!=null&&id!==subjectId)) throw error('INVALID_CLEANUP_SCOPE');
        if (row.legalHold||row.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
        const fields=privateFields.filter(field=>row[field]!==undefined);
        if (fields.length) offers.push({row,fields});
      }
      cursor=response.LastEvaluatedKey;
      if (++pages>=maxPages&&cursor) throw error('INVENTORY_INCOMPLETE');
    } while(cursor);
    return offers;
  }

  async function scope({db,request,maxPages}) {
    const groups=new Map();
    for (const offer of await inventory({db,request,maxPages})) {
      const orderId=offer.row.orderId;
      if (!groups.has(orderId)) {
        const Key={PK:'ORDER#'+orderId,SK:'META'};
        const {Item:order}=await db.send(new GetCommand({TableName:tables.orders,Key,ConsistentRead:true}));
        if (!order||order.orderId!==orderId||!terminalOrders.has(order.status)) {
          throw error('DRIVER_OFFER_SETTLEMENT_CLOSURE_REQUIRED');
        }
        if (order.legalHold||order.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
        groups.set(orderId,{order,Key,offers:[]});
      }
      groups.get(orderId).offers.push(offer);
    }
    return groups;
  }

  async function settlementGuards(db, subjectId, orderId, order, offers, maxPages, preserve) {
    if (offers.every(offer=>inactiveOffer(offer.row))) return [];
    if (order.driverId!==subjectId || order.assignedDriverId!=null&&order.assignedDriverId!==subjectId) {
      throw error('DRIVER_OFFER_SETTLEMENT_CLOSURE_REQUIRED');
    }
    const {guards,closure}=await closedExceptionGuards(db,order,maxPages);
    const payableKey={orderId,sk:'MERCHANT_PAYABLE'};
    if (closure) {
      const payable=await get(db,tables.holds,payableKey);
      if (!payable) {
        const journalKey={orderId,sk:'EXCEPTION_ENTITLEMENTS'};
        const journal=await get(db,tables.holds,journalKey);
        if (!journal||typeof verifyZeroMerchantException!=='function') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
        if (journal.legalHold||journal.retentionHold) throw error('DOCUMENTED_RETENTION_HOLD');
        verifyZeroMerchantException(order,closure,journal);
        return [...guards,
          {ConditionCheck:{TableName:tables.holds,Key:journalKey,...exact(journal)}},
          {ConditionCheck:{TableName:tables.holds,Key:payableKey,ConditionExpression:'attribute_not_exists(orderId)'}},
        ];
      }
      if(payable.status!=='PAID') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
    }
    if (!closure && offers.some(offer=>legacyAcceptedOffer(offer.row)) &&
        offers.every(offer=>inactiveOffer(offer.row)||legacyAcceptedOffer(offer.row)) &&
        !await get(db,tables.holds,payableKey)) {
      return legacyDriverSettlementGuards({db,subjectId,order,offers:offers.map(offer=>offer.row),maxPages});
    }
    const branch=order.storeId??order.businessId;
    if (preserve) await preserveMerchantSettlementEvidence(db,branch,orderId);
    const evidence=await readMerchantAccrualEvidence(db,branch,orderId);
    if (evidence.order.driverId!==subjectId || evidence.order.status!==order.status ||
        evidence.order.orderId!==orderId || (preserve&&!evidence.payable.settlementEvidence)) {
      throw error('FINANCIAL_ARCHIVE_SOURCE_REQUIRED');
    }
    if (closure && evidence.payable.status!=='PAID') throw error('ORDER_EXCEPTION_CLOSURE_REQUIRED');
    if (!preserve) return guards;
    guards.push(
      {ConditionCheck:{TableName:tables.holds,Key:payableKey,...exact(evidence.payable)}},
      {ConditionCheck:{TableName:tables.holds,Key:evidence.outcomeKey,...exact(evidence.outcome)}},
    );
    if (evidence.accountingJournal) guards.push({ConditionCheck:{TableName:tables.platform,
      Key:{pk:'FULL_CASH_JOURNAL#'+orderId,sk:'META'},...exact(evidence.accountingJournal)}});
    if (evidence.cashAdjudicationJournal) guards.push({ConditionCheck:{TableName:tables.holds,
      Key:{orderId,sk:'CASH_ADJUDICATION_JOURNAL'},...exact(evidence.cashAdjudicationJournal)}});
    return guards;
  }

  return {
    async preflight({db,request,maxPages=100}) {
      for (const [orderId,{order,offers}] of await scope({db,request,maxPages})) {
        await settlementGuards(db,request.subjectId,orderId,order,offers,maxPages,false);
      }
    },
    async redact({db,request,job,clock=Date.now,maxPages=100}) {
      driverExecutionChecks(request,job,clock());
      for (const [orderId,{order,Key,offers}] of await scope({db,request,maxPages})) {
        const evidenceGuards=await settlementGuards(db,request.subjectId,orderId,order,offers,maxPages,true);
        const orderFields=[...new Set([...Object.keys(order),'returnStatus','returnCaseId','cancellationStatus','cancellationRequestId','financialOutcome','financialAcceptance','dispatchAcceptance','holdId','holdAmount','holdStatus'])];
        const guards=[
          {ConditionCheck:{TableName:tables.orders,Key,...exact(Object.fromEntries(orderFields.map(k=>[k,order[k]])))}},
          ...evidenceGuards,
        ];
        const limit=Math.min(25,98-guards.length);
        if (limit<1) throw error('INVENTORY_INCOMPLETE');
        for (let offset=0;offset<offers.length;offset+=limit) {
          const updates=offers.slice(offset,offset+limit).map(({row,fields})=>{
            const names=Object.fromEntries(fields.map((field,index)=>['#remove'+index,field]));
            const snapshot=exact(Object.fromEntries([...new Set([...Object.keys(row),...privateFields,
              'driverId','driverSubjectId','isWinner','responseStatus','acceptedAt','dispatchReceipt','financialReceipt'])].map(field=>[field,row[field]])));
            return {Update:{TableName:tables.offers,Key:{orderId,SK:row.SK},...snapshot,
              UpdateExpression:'REMOVE '+Object.keys(names).join(', '),
              ExpressionAttributeNames:{...snapshot.ExpressionAttributeNames,...names}}};
          });
          await db.send(new TransactWriteCommand({TransactItems:[
            ...driverExecutionChecks(request,job,clock()),...guards,...updates,
          ]}));
        }
      }
    },
  };
}

module.exports={createDriverOfferCleanup};
