'use strict';
const {validCase,validDecision,uuid}=require('./driver-quality-proof-290');
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,150}$/.test(v);
async function readIncidents({db,GetCommand,QueryCommand,driverId,maxPages=5,tables}){
 if(!validId(driverId))throw Error('UNAUTHORIZED');
 const get=async(table,key)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 const profile=await get(tables.drivers,{driverId});
 if(!profile||profile.driverId!==driverId||profile.deletedAt!=null||profile.deletionRequestId!=null||profile.isDeleted===true)throw Error('UNAUTHORIZED');
 const started=Date.now();
 const offers=new Map(),seenOrders=new Set(),items=[];let cursor,complete=true,pages=0;
 do{
  if(Date.now()-started>10000){complete=false;break;}
  const r=await db.send(new QueryCommand({TableName:tables.offers,IndexName:'driverId-sentAt-index',KeyConditionExpression:'driverId=:driver',ExpressionAttributeValues:{':driver':driverId},ScanIndexForward:false,Limit:50,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  const pointers=r.Items||[];
  for(let i=0;i<pointers.length;i+=5){const current=await Promise.all(pointers.slice(i,i+5).map(pointer=>{if(pointer.driverId!==driverId||!validId(pointer.orderId)||typeof pointer.SK!=='string')throw Error('QUALITY_READ_UNAVAILABLE');return get(tables.offers,{orderId:pointer.orderId,SK:pointer.SK});}));for(const o of current)if(o?.driverId===driverId&&o.kind==='FINANCIAL_DRIVER_OFFER'&&o.responseStatus==='financial_accepted'&&o.isWinner===true&&o.financialReceipt?.success===true)offers.set(o.offerId,o);}
  cursor=r.LastEvaluatedKey;pages++;
 }while(cursor&&pages<maxPages);
 if(cursor)complete=false;
 orderLoop:for(const offer of offers.values()){
  if(Date.now()-started>10000){complete=false;break;}
  if(seenOrders.has(offer.orderId))continue;seenOrders.add(offer.orderId);
  let key,casePages=0;
  do{const r=await db.send(new QueryCommand({TableName:tables.holds,KeyConditionExpression:'orderId=:order AND begins_with(#sk,:prefix)',ExpressionAttributeNames:{'#sk':'sk'},ExpressionAttributeValues:{':order':offer.orderId,':prefix':'DRIVER_QUALITY#'},ConsistentRead:true,Limit:50,...(key?{ExclusiveStartKey:key}:{})}));
   for(const row of r.Items||[]){if(Date.now()-started>10000){complete=false;break orderLoop;}const source=offers.get(row.offerId);if(!source||!validCase(row,source,driverId)){if(row.driverId===driverId)complete=false;continue;}
    const last=row.history.at(-1),event=last&&uuid(last.id)?await get(tables.holds,{orderId:row.orderId,sk:'QUALITY_REVIEW_EVENT#'+last.id}):null;
    const verified=event&&event.kind==='DRIVER_QUALITY_REVIEW_EVENT'&&event.schemaVersion===1&&event.recordId===last.id&&event.action===last.action&&event.actorId===last.actorId&&(event.actorKind==='STAFF'||event.actorKind==='DRIVER'&&event.actorId===driverId&&event.action==='SUBMIT_DRIVER_QUALITY_APPEAL')&&event.orderId===row.orderId&&event.driverId===driverId&&event.offerId===row.offerId&&event.attempt===row.attempt&&event.sourceFingerprint===row.sourceFingerprint&&event.caseId===row.caseId&&event.receipt?.success===true&&event.receipt.version===row.version&&event.receipt.caseId===row.caseId;
    const decisionEvent=row.decision&&uuid(row.decision.id)?await get(tables.holds,{orderId:row.orderId,sk:'QUALITY_REVIEW_EVENT#'+row.decision.id}):null;
    const decisionValid=verified&&validDecision(row,decisionEvent);
    const order=await get(tables.orders,{PK:'ORDER#'+row.orderId,SK:'META'});
    items.push({incidentId:row.caseId,orderId:row.orderId,orderNumber:order?.orderNumber||'طلب سابق',category:row.category,severity:row.severity,state:verified?row.state:'VERIFICATION_PENDING',version:row.version,createdAt:row.createdAt,updatedAt:row.updatedAt,decision:decisionValid?row.decision.value:null,decisionReason:decisionValid?row.decision.reason:null,appealOpen:verified&&row.appeals.some(a=>a.status==='OPEN'),canAppeal:!!(decisionValid&&row.state==='RESOLVED'&&row.decision.value==='SUBSTANTIATED'&&!row.appeals.some(a=>a.status==='OPEN')),financialPosting:false,eligibilityEffect:'NONE',ratingEffect:'NONE'});
   }
   key=r.LastEvaluatedKey;casePages++;
  }while(key&&casePages<3);
  if(key)complete=false;
 }
 items.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 if(items.length>100)complete=false;
 return {success:true,schemaVersion:1,items:items.slice(0,100),coverageComplete:complete,coverage:'BOUNDED_VERIFIED_ACCEPTED_OFFER_HISTORY',financialPosting:false};
}
module.exports={readIncidents};
