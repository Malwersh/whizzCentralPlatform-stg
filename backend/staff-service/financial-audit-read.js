'use strict';
const {safe}=require('./audit-trail');
const fail=(code,status=400)=>Object.assign(Error(code),{status});
function day(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw fail('INVALID_AUDIT_DATE');return value;}
const financialAction=action=>typeof action==='string'&&(/^(TOPUP_|TRANSFER_|ZAINCASH_|FUNDING_|HOLD_|DRIVER_PAYOUT_|MERCHANT_PAYOUT_|MERCHANT_SETTLEMENT_|WALLET_|CASHBOX_)/.test(action)||['SETTLE_ORDER','COD_EVENT_INTEGRATED'].includes(action));
function normalize(row){const refs={...(row.references||{})};for(const k of ['walletId','topupId','transferId','requestId','paymentId','transactionId','orderId','holdId','payoutId','branchId','batchId','targetId'])if(row[k]!=null&&refs[k]==null)refs[k]=row[k];return safe({...row,source:'WALLET_AUDIT',createdAt:row.createdAt||row.timestamp||String(row.sk||'').split('#')[0],actorId:row.actorId||row.metadata?.approvedById||null,references:refs,historicalIdentityNotBackfilled:true});}
async function read({db,sdk,allowed,walletAuditTable},actor,q={}){
 if(!allowed(actor,'audit.read')||actor.scope?.allRegions!==true)throw fail('PERMISSION_REQUIRED',403);
 if(!walletAuditTable)throw fail('FINANCIAL_AUDIT_SOURCE_UNCONFIGURED',503);
 const today=new Date().toISOString().slice(0,10),from=day(q.from||today),through=day(q.through||today);
 if(from>through||(Date.parse(through)-Date.parse(from))/86400000>30)throw fail('INVALID_AUDIT_DATE_RANGE');
 const limit=q.limit===undefined?30:Number(q.limit);if(!Number.isInteger(limit)||limit<1||limit>100)throw fail('INVALID_LIMIT');
 const action=q.action||'',reference=q.reference||'';
 if(action&&!/^[A-Z0-9_]{1,120}$/.test(action)||typeof reference!=='string'||reference.length>150)throw fail('INVALID_AUDIT_FILTER');
 let current=through,key;
 if(q.cursor){try{if(typeof q.cursor!=='string'||q.cursor.length>4096)throw Error();const c=JSON.parse(Buffer.from(q.cursor,'base64url').toString());if(c.source!=='WALLET_AUDIT'||c.from!==from||c.through!==through||c.action!==action||c.reference!==reference)throw Error();current=day(c.day);if(current<from||current>through)throw Error();if(c.key){if(Object.keys(c.key).length!==2||c.key.datePartition!=='date#'+current.replaceAll('-','')||typeof c.key.sk!=='string'||c.key.sk.length>500)throw Error();key=c.key;}}catch{throw fail('INVALID_CURSOR');}}
 const items=[];let pages=0,done=false;
 // Bound work even when filters match nothing. Return continuation, never scan the table.
 while(pages++<5&&items.length<limit){
  const partition='date#'+current.replaceAll('-','');
  const r=await db.send(new sdk.QueryCommand({TableName:walletAuditTable,KeyConditionExpression:'datePartition = :partition',ExpressionAttributeValues:{':partition':partition},ConsistentRead:true,ScanIndexForward:false,Limit:limit-items.length,...(key?{ExclusiveStartKey:key}:{})}));
  for(const row of r.Items||[]){if(row.datePartition!==partition||!financialAction(row.action))continue;if(action&&row.action!==action)continue;const n=normalize(row);if(reference&&!JSON.stringify(n.references).includes(reference)&&![row.walletId,row.transferId,row.topupId,row.requestId,row.paymentId,row.targetId].some(v=>typeof v==='string'&&v.includes(reference)))continue;items.push(n);}
  key=r.LastEvaluatedKey;
  if(!key){if(current===from){done=true;break;}current=new Date(Date.parse(current)-86400000).toISOString().slice(0,10);}
 }
 return {source:'WALLET_AUDIT',items,nextCursor:done?null:Buffer.from(JSON.stringify({source:'WALLET_AUDIT',from,through,action,reference,day:current,...(key?{key}:{})})).toString('base64url'),coverage:{from,through,complete:done,scope:'FINANCIAL_ACTION_AUDIT_ONLY',note:'سجل إجراءات؛ ليس إثباتًا مستقلًا لحركة الرصيد. راجع القيود والمراجع المرتبطة.'},historicalIdentityNotBackfilled:true};
}
module.exports={read,normalize,financialAction};
