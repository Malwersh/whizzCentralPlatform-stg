'use strict';

const { QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { pendingQualityReviews } = require('../../../backend/account-deletion/quality-review-retention-290');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { createEvidence, tables } = require('./evidence.cjs');

const performanceTable='wizz-production-DriverPerformanceSnapshots';
const privateKeys=new Set(['driverPhone','driverEmail','driverName','driverLocation','driverPosition',
  'driverLatitude','driverLongitude','driverAddress','location','position','pickupRoute','driverPoint']);
function hasPrivateData(value) {
  return value && typeof value==='object' && Object.entries(value).some(([key,child])=>
    child!=null && (privateKeys.has(key) || hasPrivateData(child)));
}

async function reviewDriverLinkedRecords({ db, request, maxPages=100 }) {
  const { subjectId }=request;
  let performanceCursor;
  for(let page=0;page<maxPages;page++) {
    const result=await db.send(new QueryCommand({
      TableName:performanceTable,ConsistentRead:true,Limit:100,ExclusiveStartKey:performanceCursor,
      KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':'DRIVER#'+subjectId},
    }));
    for(const row of result.Items??[]) {
      if(row.pk!=='DRIVER#'+subjectId || row.driverId!==undefined&&row.driverId!==subjectId) {
        throw error('INVALID_CLEANUP_SCOPE');
      }
      if(row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
    }
    performanceCursor=result.LastEvaluatedKey;
    if(!performanceCursor)break;
  }
  if(performanceCursor)throw error('INVENTORY_INCOMPLETE');
  const directSources=[
    [tables.holds,'driverId=:driver OR subjectId=:driver OR walletId=:wallet',':wallet','WALLET#DRIVER#'+subjectId],
    [tables.events,'driverId=:driver OR subjectId=:driver OR walletId=:wallet',':wallet','WALLET#DRIVER#'+subjectId],
    [tables.dispatch,'driverId=:driver OR subjectId=:driver OR assignedDriverId=:driver'],
    ['wizz-production-OrderRatings','driverId=:driver OR driverRatingKey=:partition',':partition','DRIVER#'+subjectId],
    [tables.supportSessions,'driverId=:driver OR (userId=:driver AND userType=:type)',':type','driver'],
  ];
  for(const [TableName,FilterExpression,extraKey,extraValue] of directSources) {
    let cursor,pages=0;
    do {
      const response=await db.send(new ScanCommand({
        TableName,FilterExpression,ExpressionAttributeValues:{':driver':subjectId,...(extraKey?{[extraKey]:extraValue}:{})},
        ConsistentRead:true,Limit:250,ExclusiveStartKey:cursor,
      }));
      for(const row of response.Items??[]) {
        if (row.legalHold||row.retentionHold||row.evidenceRetention) throw error('DOCUMENTED_RETENTION_HOLD');
        if (TableName===tables.supportSessions) throw error('DRIVER_SUPPORT_RETENTION_REVIEW_REQUIRED');
        if (TableName==='wizz-production-OrderRatings') throw error('DRIVER_RATING_RETENTION_REVIEW_REQUIRED');
        if (TableName===tables.holds && pendingQualityReviews([row],[subjectId]).length) {
          throw error('DRIVER_LINKED_DATA_REVIEW_REQUIRED');
        }
        if (hasPrivateData(row)) throw error('DRIVER_LINKED_DATA_REVIEW_REQUIRED');
      }
      cursor=response.LastEvaluatedKey;
      if(++pages>=maxPages&&cursor)throw error('INVENTORY_INCOMPLETE');
    }while(cursor);
  }
}

async function purgeDriverPerformance({db,request,job,clock=Date.now,maxBatches=100}) {
  const pk='DRIVER#'+request.subjectId;
  for(let batch=0;batch<maxBatches;batch++) {
    const checks=driverExecutionChecks(request,job,clock());
    const {Items=[],LastEvaluatedKey}=await db.send(new QueryCommand({
      TableName:performanceTable,ConsistentRead:true,Limit:25,
      KeyConditionExpression:'pk=:pk',ExpressionAttributeValues:{':pk':pk},
    }));
    if(!Items.length) {
      if(LastEvaluatedKey)throw error('INVENTORY_INCOMPLETE');
      return;
    }
    for(const row of Items) {
      if (row.pk!==pk || typeof row.sk!=='string' ||
          row.driverId!==undefined && row.driverId!==request.subjectId) throw error('INVALID_CLEANUP_SCOPE');
      if (row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
    }
    await db.send(new TransactWriteCommand({TransactItems:[
      ...checks,
      {ConditionCheck:{TableName:tables.driver,Key:{driverId:request.subjectId},
        ConditionExpression:'attribute_not_exists(driverId)'}},
      ...Items.map(row=>({Delete:{TableName:performanceTable,Key:{pk,sk:row.sk},...exact(row)}})),
    ]}));
  }
  throw error('INVENTORY_INCOMPLETE');
}

function createDriverDeletionEvidence({db,clock=Date.now}) {
  const read=createEvidence({db,clock});
  return async (actor,scope,options) => {
    const facts=await read(actor,scope,options);
    try {
      await reviewDriverLinkedRecords({db,request:{subjectId:actor.sub}});
    } catch (cause) {
      const reviewField = {
        DRIVER_SUPPORT_RETENTION_REVIEW_REQUIRED:'driverSupportRetentionReview',
        DRIVER_RATING_RETENTION_REVIEW_REQUIRED:'driverRatingRetentionReview',
        DOCUMENTED_RETENTION_HOLD:'driverDocumentedRetentionHold',
      }[cause.code];
      if (reviewField) facts[reviewField]=true;
      else if (cause.code==='DRIVER_LINKED_DATA_REVIEW_REQUIRED') {
        facts.pendingReviews=[...(facts.pendingReviews??[]),{status:cause.code}];
      } else throw cause;
    }
    return facts;
  };
}
module.exports={createDriverDeletionEvidence,reviewDriverLinkedRecords,purgeDriverPerformance};
