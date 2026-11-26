'use strict';

const {GetCommand}=require('@aws-sdk/lib-dynamodb');
const validId=value=>typeof value==='string' && /^[A-Za-z0-9_:#.-]{1,200}$/.test(value);
const get=async (client,TableName,Key)=>(await client.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item;

async function supportReplyAllowed(client,item,tables) {
  const complaint=item.type==='order_complaint_updated';
  if ((!complaint && item.type!=='support_reply') || item.recipientApp!=='user' || !validId(item.driverId) ||
      !validId(item.sessionId) || (item.orderId!=null && !validId(item.orderId))) return false;
  const [session,customer,lock]=await Promise.all([
    get(client,tables.sessions,{sessionId:item.sessionId}),
    get(client,tables.customers,{userId:item.driverId}),
    get(client,tables.deletion,{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+item.driverId,sk:'META'}),
  ]);
  return session?.userType==='customer' && session.customerId===item.driverId &&
    session.userId===item.driverId && (!complaint || session.complaintCaseId===item.caseId) && (session.orderId??null)===(item.orderId??null) &&
    customer?.userId===item.driverId && customer.cognitoSub===item.driverId &&
    customer.isActive!==false && !customer.isDeleted && !customer.deletedAt && !customer.deletionRequestId && !lock;
}

async function supportReplyDeviceAllowed(client,item,record,tables,at) {
  const current=await get(client,tables.pushTokens,{token:record.token});
  return current?.app==='user' && current.subjectId===item.driverId && current.token===record.token &&
    Number.isFinite(current.ttl) && current.ttl>Math.floor(at/1000);
}

module.exports={supportReplyAllowed,supportReplyDeviceAllowed};
