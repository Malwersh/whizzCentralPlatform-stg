'use strict';
// Linking and completion are review actions, never monetary postings.
const {GetCommand,QueryCommand}=require('@aws-sdk/lib-dynamodb');
const P='staging-MerchantPlatform',H='staging-Holds',L='staging-WalletLifecycle';
module.exports=async function plan({db,input:v,branch,ownerId,actorId,at,hash,check,put,fail}){
 const fields={ 'staging-Holds':['orderId','sk','kind','version','exceptionResolution','caseId','financialClosure','activeResponsibilityFindingId','entitlementsPosted','correctionReview','caseAppeals','appealReviewRequired'],WizzOrders:['PK','SK','orderId','storeId','deletedAt','deletionRequestId','isDeleted'] };
 const get=async(t,k)=>{const f=fields[t],n=f?Object.fromEntries(f.map((v,i)=>['#f'+i,v])):null;return (await db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true,...(n?{ProjectionExpression:Object.keys(n).join(','),ExpressionAttributeNames:n}:{})}))).Item;};
 const sealed=r=>{const {digest,...body}=r||{};return typeof digest==='string'&&digest===hash(body);};
 const ck={orderId:v.orderId,sk:v.caseKey},row=await get(H,ck),orderKey={PK:'ORDER#'+v.orderId,SK:'META'},order=await get('WizzOrders',orderKey);
 const caseId=row?.exceptionResolution?.caseId||row?.caseId;
 if(!order||order.storeId!==branch||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true||!row||caseId!==v.caseId||row.version!==v.caseVersion||!['COD_RETURN_CASE','CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION'].includes(row.kind))fail('CORRECTION_CASE_CHANGED');
 const orderFence={storeId:order.storeId,deletedAt:order.deletedAt,deletionRequestId:order.deletionRequestId,isDeleted:order.isDeleted};
 const ops=[check('WizzOrders',orderKey,orderFence)],next={...row,version:row.version+1,updatedAt:at},review=row.correctionReview,signature=hash({finding:row.activeResponsibilityFindingId||null,entitlements:row.entitlementsPosted||null});
 if(v.action==='LINK_CORRECTION_CASE'){
  const correctionKey={pk:'MERCHANT_CORRECTIONS#'+branch,sk:'REQUEST#'+v.correctionId},correction=await get(P,correctionKey);
  if(!correction||correction.ownerId!==ownerId||correction.branchId!==branch||correction.orderId!==v.orderId||!['PENDING_APPROVAL','POSTED'].includes(correction.status))fail('CORRECTION_CASE_SOURCE_INVALID');
  if(correction.caseLink&&(correction.caseLink.caseId!==caseId||correction.caseLink.caseKey!==v.caseKey))fail('CORRECTION_CASE_SOURCE_INVALID');
  if(review&&review.status!=='COMPLETED'&&review.signature!==signature)fail('CORRECTION_CASE_REVIEW_CHANGED');
  const appeal=v.appealId?(row.caseAppeals||[]).find(a=>a.appealId===v.appealId&&a.topic==='FINANCIAL'&&a.actorKind==='MERCHANT_OWNER'&&a.actorId===ownerId&&a.status==='REVIEW_REQUIRED'):null;
  if(v.appealId&&!appeal)fail('CORRECTION_CASE_APPEAL_INVALID');
  const ids=[...new Set([...(review?.status==='PENDING'?review.correctionIds:[]),v.correctionId])];if(ids.length>16)fail('CORRECTION_CASE_LIMIT');
  next.correctionReview={status:'PENDING',correctionIds:ids,signature,openedAt:review?.status==='PENDING'?review.openedAt:at,updatedAt:at,actorId,reason:v.reason.trim(),appealIds:[...new Set([...(review?.status==='PENDING'?review.appealIds||[]:[]),...(v.appealId?[v.appealId]:[])])]};
  ops.push(put({...correction,caseLink:{caseId,caseKey:v.caseKey,orderId:v.orderId},version:correction.version+1},correction));
 }else{
  if(!review||review.status!=='PENDING'||review.signature!==signature)fail('CORRECTION_CASE_REVIEW_CHANGED');
  const reservations=[];let cursor;
  for(let page=0;page<20;page++){const q=await db.send(new QueryCommand({TableName:P,ConsistentRead:true,KeyConditionExpression:'pk=:pk AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':pk':'MERCHANT_CORRECTIONS#'+branch,':prefix':'RESERVATION#'},Limit:50,...(cursor?{ExclusiveStartKey:cursor}:{})}));reservations.push(...q.Items||[]);cursor=q.LastEvaluatedKey;if(!cursor)break;}
  if(cursor)fail('CORRECTION_CASE_LIMIT');
  const payoutProofs=new Map();
  for(const id of review.correctionIds){
   const k={pk:'MERCHANT_CORRECTIONS#'+branch,sk:'REQUEST#'+id},r=await get(P,k);
   if(!r||r.ownerId!==ownerId||r.orderId!==v.orderId||r.caseLink?.caseId!==caseId||!['POSTED','REJECTED'].includes(r.status))fail('CORRECTION_CASE_WORK_REMAINS');ops.push(check(P,k,r));
   if(r.status==='REJECTED')continue;
   if(r.settledIqd!==r.amountIqd||(r.reservedIqd||0)!==0)fail('CORRECTION_CASE_WORK_REMAINS');
   const jk={pk:k.pk,sk:'JOURNAL#'+id},j=await get(P,jk);
   if(!sealed(j)||j.correctionId!==id||j.requestDigest!==r.requestDigest||j.ownerId!==ownerId||j.branchId!==branch||j.amountIqd!==r.amountIqd||j.direction!==r.direction)fail('CORRECTION_CASE_SOURCE_INVALID');ops.push(check(P,jk,j));
   let total=0;
   for(const reservation of reservations.filter(q=>q.status==='SETTLED'&&q.snapshot?.allocations?.some(a=>a.correctionId===id))){
    const a=reservation.snapshot.allocations.find(a=>a.correctionId===id);
    if(!sealed(reservation)||!sealed(reservation.snapshot)||reservation.ownerId!==ownerId||reservation.branchId!==branch||a.direction!==r.direction||a.requestDigest!==r.requestDigest||!Number.isSafeInteger(a.amountIqd)||a.amountIqd<=0)fail('CORRECTION_CASE_SOURCE_INVALID');
    total+=a.amountIqd;
    if(!payoutProofs.has(reservation.payoutId)){
     const pk={pk:'MERCHANT_PAYOUT_PAID#'+reservation.payoutId,sk:'META'},paid=await get(P,pk);
     if(!sealed(paid)||paid.status!=='PAID'||paid.ownerId!==ownerId||paid.branchId!==branch||paid.payoutId!==reservation.payoutId||paid.paidAt!==reservation.completedAt||hash(paid.correctionSettlement)!==hash(reservation.snapshot))fail('CORRECTION_CASE_SOURCE_INVALID');
     payoutProofs.set(reservation.payoutId,true);ops.push(check(P,pk,paid),check(P,{pk:reservation.pk,sk:reservation.sk},reservation));
    }
   }
   if(total!==r.amountIqd)fail('CORRECTION_CASE_SOURCE_INVALID');
  }
  for(const id of review.appealIds||[]){const a=(row.caseAppeals||[]).find(a=>a.appealId===id);if(!a||a.topic!=='FINANCIAL'||a.actorKind!=='MERCHANT_OWNER'||a.actorId!==ownerId||a.status!=='REVIEW_REQUIRED')fail('CORRECTION_CASE_APPEAL_INVALID');}
  next.caseAppeals=(row.caseAppeals||[]).map(a=>(review.appealIds||[]).includes(a.appealId)?{...a,status:'RESOLVED_FINANCIAL_CORRECTION',reviewCompletion:{actorId,reason:v.reason.trim(),at,correctionIds:review.correctionIds,financialPosting:false}}:a);
  if((review.appealIds||[]).includes(row.appealReviewRequired?.appealId))delete next.appealReviewRequired;
  next.correctionReview={...review,status:'COMPLETED',completedAt:at,completedBy:actorId,completionReason:v.reason.trim()};
 }
 const originalClosed=!!row.financialClosure,otherAppeal=(next.caseAppeals||[]).some(a=>['OPEN','REVIEW_REQUIRED'].includes(a.status)),open=next.correctionReview.status!=='COMPLETED'||!originalClosed||otherAppeal;
 const ik={operationId:'EXCEPTION_CASE#'+caseId},oldIndex=await get(L,ik);
 if(oldIndex&&(oldIndex.kind!=='ORDER_EXCEPTION_CASE_POINTER'||oldIndex.orderId!==v.orderId||oldIndex.caseKey!==v.caseKey||oldIndex.caseId!==caseId))fail('CORRECTION_CASE_SOURCE_INVALID');
 const index={...(oldIndex||{}),...ik,kind:'ORDER_EXCEPTION_CASE_POINTER',schemaVersion:1,caseId,orderId:v.orderId,branchId:branch,caseKey:v.caseKey,caseType:row.kind==='COD_RETURN_CASE'?'COD_DELIVERY_EXCEPTION':row.kind,status:open?'OPEN':'CLOSED',caseState:open?'CORRECTION_REVIEW':'RESOLVED',version:(oldIndex?.version||0)+1,queuePartition:open?'ORDER_EXCEPTIONS_OPEN':'ORDER_EXCEPTIONS_CLOSED',nextAttemptAt:Math.floor(Date.parse(at)/1000),createdAt:oldIndex?.createdAt||at,updatedAt:at};
 const conditionalPut=(table,item,old,key)=>{if(!old)return {Put:{TableName:table,Item:item,ConditionExpression:'attribute_not_exists('+Object.keys(key)[0]+')'}};const {Key,...fence}=check(table,key,old).ConditionCheck;return {Put:{...fence,Item:item}};};
 const names={'#v':'version','#r':'correctionReview','#at':'updatedAt','#a':'caseAppeals','#ar':'appealReviewRequired','#kind':'kind'},values={':v':row.version,':kind':row.kind,':next':next.version,':review':next.correctionReview,':at':at,':appeals':next.caseAppeals||[]};
 names['#case']=row.exceptionResolution?'exceptionResolution':'caseId';if(row.exceptionResolution)names['#id']='caseId';values[':case']=caseId;
 const update={TableName:H,Key:ck,ConditionExpression:'#v=:v AND #kind=:kind AND #case'+(row.exceptionResolution?'.#id':'')+'=:case',ExpressionAttributeNames:names,ExpressionAttributeValues:values,UpdateExpression:'SET #v=:next,#r=:review,#at=:at,#a=:appeals'+(next.appealReviewRequired?' ,#ar=:ar':' REMOVE #ar')};
 if(next.appealReviewRequired)values[':ar']=next.appealReviewRequired;
 ops.push({Update:update},conditionalPut(L,index,oldIndex,ik));
 if(ops.length>85)fail('CORRECTION_CASE_LIMIT');
 return {ops,receipt:{caseReview:next.correctionReview,caseVersion:next.version,caseId,orderId:v.orderId,caseRemainsOpen:open,financialPosting:false}};
};
