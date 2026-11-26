'use strict';

const { GetCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { exact } = require('../../../backend/account-deletion/cod-retention');
const { error } = require('../../../backend/account-deletion/policy');
const { driverPhoneClosureKey } = require('../../../backend/account-deletion/driver-phone-binding');
const { tables } = require('./evidence.cjs');
const { driverExecutionChecks } = require('./customer-execution-scope.cjs');

const otpTable = 'wizz-production-DriverOtpSessions';

async function purgeDriverRegistration({ db, request, job, clock = Date.now, maxPages = 100 }) {
  driverExecutionChecks(request,job,clock());
  const Key=driverPhoneClosureKey(job.phone);
  const get=async (TableName,Key)=>(await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;
  const marker=await get(tables.deletion,Key);
  if (marker?.subjectId!==request.subjectId || marker.requestId!==request.requestId ||
      !Number.isSafeInteger(marker.lockedAt) || marker.legalHold || marker.retentionHold) {
    throw error('DRIVER_ENROLLMENT_CLEANUP_REQUIRED');
  }
  if (Math.floor(clock()/1000)<marker.lockedAt+60) throw error('DRIVER_ENROLLMENT_WRITES_DRAINING');
  if (job.username!==request.subjectId) throw error('DRIVER_IDENTITY_CHANGED');
  const phoneGuard={ConditionCheck:{TableName:tables.deletion,Key,...exact(marker)}};
  const records=new Map();
  let cursor, pages=0;
  do {
    const result=await db.send(new ScanCommand({
      TableName:otpTable,ConsistentRead:true,Limit:250,ExclusiveStartKey:cursor,
      FilterExpression:'(#purpose=:otp AND phone=:phone) OR (#purpose=:proof AND username=:username)',
      ExpressionAttributeNames:{'#purpose':'purpose'},
      ExpressionAttributeValues:{':otp':'registration-otp',':proof':'login-proof',':phone':job.phone,':username':job.username},
    }));
    for(const row of result.Items??[]) {
      if (!row.id || !((row.purpose==='registration-otp' && row.phone===job.phone) ||
          (row.purpose==='login-proof' && row.username===job.username))) throw error('INVALID_CLEANUP_SCOPE');
      records.set(row.id,row);
    }
    cursor=result.LastEvaluatedKey;
    if (++pages>=maxPages && cursor) throw error('INVENTORY_INCOMPLETE');
  } while(cursor);
  const active=await get(otpTable,{id:'ACTIVE#'+job.phone});
  const login=await get(otpTable,{id:'LOGIN#'+job.username});
  const provision=await get(otpTable,{id:'PROVISION#'+job.phone});
  if (active?.sessionId && !records.has(active.sessionId) && await get(otpTable,{id:active.sessionId}) ||
      login?.proofId && !records.has(login.proofId) && await get(otpTable,{id:login.proofId}) ||
      provision?.username && ![job.username,job.phone].includes(provision.username)) {
    throw error('DRIVER_IDENTITY_CHANGED');
  }
  for (const row of [active,login,provision]) if (row) records.set(row.id,row);
  const found=[...records.values()];
  if (found.some(row=>row.legalHold || row.retentionHold)) throw error('DOCUMENTED_RETENTION_HOLD');
  for(let offset=0;offset<found.length;offset+=25) {
    await db.send(new TransactWriteCommand({TransactItems:[
      ...driverExecutionChecks(request,job,clock()),phoneGuard,
      ...found.slice(offset,offset+25).map(row=>({Delete:{TableName:otpTable,Key:{id:row.id},...exact(row)}})),
    ]}));
  }
  return [phoneGuard];
}

module.exports={purgeDriverRegistration};
