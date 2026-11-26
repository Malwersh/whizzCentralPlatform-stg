'use strict';

const {GetCommand} = require('@aws-sdk/lib-dynamodb');
const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(value);
const get = async (db, TableName, Key) => (await db.send(new GetCommand({TableName, Key, ConsistentRead:true}))).Item;

async function returnNoticeAllowed(db, item, tables) {
  const task = item.type === 'driver_return_task_updated';
  const driver = item.recipientApp === 'driver';
  const type = driver ? 'driver_exception_financial_updated' : 'merchant_exception_financial_updated';
  if (task ? !driver || !/^RETURN_TASK_NOTICE#[a-f0-9]{64}$/.test(item.eventId)
    : !['driver','merchant'].includes(item.recipientApp) || item.type !== type ||
      !/^EXCEPTION_FINANCIAL_NOTICE#[a-f0-9]{64}$/.test(item.eventId)) return false;
  if (![item.orderId,item.branchId,item.driverId,item.financialDriverId,item.financialSubjectId,
        task ? item.returnId : item.caseId].every(validId)) return false;
  if (!driver) return true; // Merchant delivery also checks the current owner and branch opt-in for each device.
  if (item.driverId !== item.financialSubjectId) return false;
  const profile=await get(db,tables.drivers,{driverId:item.financialDriverId});
  if (!profile || (profile.cognitoSub ?? profile.driverId) !== item.driverId ||
      profile.isDeleted || profile.deletedAt || profile.deletionRequestId) return false;
  const locks=['ACCOUNT_LIFECYCLE#DRIVER#'+item.financialDriverId,
    'ACCOUNT_LIFECYCLE#DRIVER#'+item.driverId,'BUSINESS_LIFECYCLE#MERCHANT#'+item.branchId];
  return !(await Promise.all([...new Set(locks)].map(pk=>get(db,tables.deletion,{pk,sk:'META'})))).some(Boolean);
}

async function returnNoticeDeviceAllowed(db,item,record,tables,now) {
  const live = await get(db,tables.pushTokens,{token:record.token});
  return live?.app === item.recipientApp && live.subjectId === item.driverId && live.token === record.token &&
    Number.isFinite(live.ttl) && live.ttl > Math.floor(now/1000);
}

module.exports={returnNoticeAllowed,returnNoticeDeviceAllowed};
