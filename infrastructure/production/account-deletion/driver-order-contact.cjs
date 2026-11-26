'use strict';

const { isDeepStrictEqual } = require('node:util');
const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { financialRecord } = require('../../../backend/account-deletion/customer-cleanup');
const { retentionSettings } = require('../../../backend/account-deletion/settings');
const { error } = require('../../../backend/account-deletion/policy');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');
const { tables, terminalOrders } = require('./evidence.cjs');

const archiveTable='wizz-production-AccountDeletionFinancialArchive';
const personalFields=['driverName','driverPhone','driverEmail','driverLocation','driverLatitude','driverLongitude'];
const orderFields=['orderId','storeId','businessId','status','paymentMethod','paymentStatus','currency',
  'createdAt','deliveredAt','completedAt','canceledAt','totalAmount','subtotal','total','deliveryFee','tax','discount'];

async function redactDriverOrderContact({db,request,job,clock=Date.now,maxPages=100}) {
  driverExecutionChecks(request,job,clock());
  if(request.policyVersion!==job.policyVersion)throw error('INVALID_CLEANUP_SCOPE');
  const policy=await retentionSettings({db,table:tables.staff,environment:'production'})('DRIVER',job.policyVersion);
  if(policy.financialRetentionYears!==job.financialYears)throw error('RETENTION_POLICY_INVALID');
  const now=new Date(clock()).toISOString(), records=[];
  let cursor,pages=0;
  do {
    const {Items=[],LastEvaluatedKey}=await db.send(new ScanCommand({
      TableName:tables.orders,ConsistentRead:true,Limit:250,ExclusiveStartKey:cursor,
      FilterExpression:'SK=:meta AND (driverId=:driver OR assignedDriverId=:driver)',
      ExpressionAttributeValues:{':meta':'META',':driver':request.subjectId},
    }));
    for(const row of Items){
      if(row.PK!=='ORDER#'+row.orderId||row.SK!=='META'||typeof row.orderId!=='string'||
          ![row.driverId,row.assignedDriverId].includes(request.subjectId)||
          [row.driverId,row.assignedDriverId].some(id=>id!=null&&id!==request.subjectId))throw error('INVALID_CLEANUP_SCOPE');
      if(row.legalHold||row.retentionHold)throw error('DOCUMENTED_RETENTION_HOLD');
      if(!terminalOrders.has(String(row.status).toLowerCase()))throw error('ACTIVE_ORDER_AFTER_LOCK');
      if(row.driverContactDeletionRequestId&&row.driverContactDeletionRequestId!==request.requestId)throw error('INVALID_CLEANUP_SCOPE');
      const fields=personalFields.filter(field=>row[field]!==undefined);
      if(!fields.length)continue;
      const source=Object.fromEntries(orderFields.filter(field=>row[field]!==undefined).map(field=>[field,row[field]]));
      if(Object.values(source).some(value=>value!==null&&typeof value!=='string'&&!Number.isSafeInteger(value))||
          !source.createdAt)throw error('FINANCIAL_RECORD_INVALID');
      const key={PK:row.PK,SK:row.SK};
      const archiveKey={pk:'REQUEST#'+request.requestId,sk:'DRIVER_ORDER#'+JSON.stringify(key)};
      records.push({row,fields,key,archiveKey,archive:{...archiveKey,
        ...financialRecord(source,'order',job,now),sourceTable:tables.orders,sourceKey:key}});
    }
    cursor=LastEvaluatedKey;
    if(++pages>=maxPages&&cursor)throw error('INVENTORY_INCOMPLETE');
  }while(cursor);

  for(const {row,fields,key,archiveKey,archive} of records){
    const existing=(await db.send(new GetCommand({TableName:archiveTable,Key:archiveKey,ConsistentRead:true}))).Item;
    if(existing&&!isDeepStrictEqual(existing,{...archive,archivedAt:existing.archivedAt}))throw error('ARCHIVE_CONFLICT');
    const names=Object.fromEntries(fields.map((field,index)=>['#remove'+index,field]));
    const snapshot=Object.fromEntries([...new Set([...Object.keys(row),...personalFields,
      'driverId','assignedDriverId','driverContactDeletionRequestId'])].map(field=>[field,row[field]]));
    const guard=exact(snapshot);
    await db.send(new TransactWriteCommand({TransactItems:[
      ...driverExecutionChecks(request,job,clock()),
      {ConditionCheck:{TableName:tables.staff,
        Key:{pk:'OPERATIONAL_SETTINGS#ACCOUNT_DELETION',sk:'VERSION#'+job.policyVersion},
        ConditionExpression:'policyVersion=:policy AND #values.financialRetentionYears=:years AND attribute_exists(approvedAt) AND attribute_exists(approvedBy)',
        ExpressionAttributeNames:{'#values':'values'},ExpressionAttributeValues:{':policy':job.policyVersion,':years':job.financialYears}}},
      existing?{ConditionCheck:{TableName:archiveTable,Key:archiveKey,...exact(existing)}}:
        {Put:{TableName:archiveTable,Item:archive,ConditionExpression:'attribute_not_exists(pk)'}},
      {Update:{TableName:tables.orders,Key:key,...guard,
        UpdateExpression:'SET #request=:request REMOVE '+Object.keys(names).join(', '),
        ExpressionAttributeNames:{...guard.ExpressionAttributeNames,...names,'#request':'driverContactDeletionRequestId'},
        ExpressionAttributeValues:{...guard.ExpressionAttributeValues,':request':request.requestId}}},
    ]}));
  }
}

module.exports={redactDriverOrderContact};
