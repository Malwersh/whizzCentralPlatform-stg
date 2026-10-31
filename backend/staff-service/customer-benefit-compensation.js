'use strict';
// Links an EXISTING personal voucher. It never grants a new voucher or posts cash.
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const {digest,fence}=require('./campaign-version');
const {readPlatformBenefit,benefitGrantKey,BENEFIT_TABLE}=require('./platform-benefits-runtime');
const H='staging-Holds',C='WizzCentral_Platform_Discounts';
const fail=(code,status=409)=>{throw Object.assign(Error(code),{status});};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const validKey=k=>['CUSTOMER_CANCELLATION','MERCHANT_CANCELLATION','CUSTOMER_CASH_REVIEW','CUSTOMER_POST_DELIVERY'].includes(k)||/^RETURN#[1-9][0-9]{0,2}$/.test(k||'');
const checked=(table,key,row)=>({ConditionCheck:{TableName:table,Key:key,...fence(row)}});
const closed=row=>!!row.financialClosure||row.exceptionResolution?.status==='RESOLVED'||row.kind==='CUSTOMER_CASH_REVIEW_CASE'&&row.state==='CLOSED';
function voucherState(c,g,now){
 if(!c||!g||![g.version,g.grantedUses,g.usedUses,g.reservedUses].every(Number.isSafeInteger)||g.version<1||g.grantedUses<1||g.usedUses<0||g.reservedUses<0||g.usedUses+g.reservedUses>g.grantedUses)return 'UNAVAILABLE';
 if(g.revoked===true)return 'REVOKED';
 if(g.usedUses>0)return 'USED';
 if(g.reservedUses>0)return 'RESERVED';
 if(Date.parse(c.endDate)<=now)return 'EXPIRED';
 if(c.status!=='active'||c.isActive!==true)return 'PAUSED';
 if(Date.parse(c.startDate)>now)return 'NOT_STARTED';
 return 'AVAILABLE';
}
function eligible(c,g,sub){
 try{const b=readPlatformBenefit(c.benefit);return b.kind==='GOODS_AMOUNT'&&b.grantMode==='DIRECT'&&b.usesPerCustomer===1&&b.audience==='ALL'&&(!b.customerIds.length||b.customerIds.includes(sub))&&g&&Number.isSafeInteger(g.version)&&g.version>0&&g.grantedUses===1&&g.usedUses===0&&g.reservedUses===0&&g.revoked===false&&!g.compensationReference;}catch{return false;}
}
async function route(ctx,actor,method,input={}){
 if(actor.scope?.allRegions!==true||!allowed(actor,'finance.read')||!allowed(actor,'promotions.read'))fail('PERMISSION_REQUIRED',403);
 const keys=method==='GET'?['orderId','caseKey']:['orderId','caseKey','caseId','expectedVersion','campaignId','campaignRevision','grantRevision','requestId','reason'];
 if(!['GET','POST'].includes(method)||Object.keys(input).sort().join(',')!==keys.sort().join(',')||!id(input.orderId)||!validKey(input.caseKey))fail('CUSTOMER_COMPENSATION_INVALID',400);
 const get=async(t,k)=>(await ctx.db.send(new GetCommand({TableName:t,Key:k,ConsistentRead:true}))).Item;
 const ok={PK:'ORDER#'+input.orderId,SK:'META'},ck={orderId:input.orderId,sk:input.caseKey};
 const [order,row]=await Promise.all([get('WizzOrders',ok),get(H,ck)]);
 const caseId=row?.caseId||row?.exceptionResolution?.caseId;
 if(!order||order.orderId!==input.orderId||!id(order.userSub)||order.isGuestOrder===true||!row||row.orderId!==input.orderId||!caseId||!Number.isSafeInteger(row.version)||row.version<1||[order,row].some(x=>x.deletedAt!=null||x.deletionRequestId!=null||x.isDeleted===true))fail('CUSTOMER_COMPENSATION_UNAVAILABLE',404);
 const pk={userId:order.userSub},profile=await get('WizzUser_users_staging',pk);
 if(!profile||profile.userId!==order.userSub||profile.cognitoSub!==order.userSub||profile.isActive===false||profile.deletionRequestId!=null||profile.deletedAt!=null)fail('CUSTOMER_COMPENSATION_UNAVAILABLE',404);
 const linkKey={pk:'USER#'+order.userSub,sk:'CASE_COMPENSATION#'+caseId},saved=await get(BENEFIT_TABLE,linkKey),now=ctx.now?ctx.now():Date.now();
 if(method==='GET'){
  const items=[];
  if(!saved&&!closed(row)){let cursor;for(let page=0;page<20;page++){
   const result=await ctx.db.send(new ScanCommand({TableName:C,ConsistentRead:true,Limit:50,ExclusiveStartKey:cursor}));
   for(const c of result.Items||[]){if(!c.benefit)continue;const g=await get(BENEFIT_TABLE,benefitGrantKey(c.discountId,order.userSub));if(eligible(c,g,order.userSub)&&voucherState(c,g,now)==='AVAILABLE')items.push({id:c.discountId,title:c.title||c.name,amountIqd:c.benefit.amountIqd,minimumGoodsIqd:c.benefit.minimumGoodsIqd,branchRestricted:c.benefit.branchIds.length>0,regionRestricted:c.benefit.regionIds.length>0,expiresAt:c.endDate,campaignRevision:digest(c),grantRevision:digest(g)});}
   cursor=result.LastEvaluatedKey;if(!cursor)break;if(page===19)fail('CUSTOMER_COMPENSATION_LIST_LIMIT');
  }}
  let link=null;if(saved){if(saved.orderId!==order.orderId||saved.caseId!==caseId)fail('CUSTOMER_COMPENSATION_PROOF_INVALID');const [c,g]=await Promise.all([get(C,{discountId:saved.campaignId}),get(BENEFIT_TABLE,benefitGrantKey(saved.campaignId,order.userSub))]);link={campaignId:saved.campaignId,title:saved.title,amountIqd:saved.amountIqd,recordedAt:saved.createdAt,state:g?.compensationReference?.caseId===caseId&&g?.compensationReference?.orderId===order.orderId&&c?.benefit?.amountIqd===saved.amountIqd?voucherState(c,g,now):'UNAVAILABLE',cashRefundPerformed:false};}
  return {orderNumber:order.orderNumber||order.orderId,caseId,version:row.version,closed:closed(row),canRecord:!saved&&!closed(row)&&(input.caseKey!=='CUSTOMER_POST_DELIVERY'||row.state==='REMEDY_PENDING')&&allowed(actor,'finance.approve')&&allowed(actor,'promotions.grant'),items,link,cashRefundPerformed:false};
 }
 if(!allowed(actor,'finance.approve')||!allowed(actor,'promotions.grant'))fail('PERMISSION_REQUIRED',403);
 if(!ctx.enrolled)fail('ENROLLMENT_REQUIRED',403);ctx.recent(ctx.claims);
 if(!uuid(input.requestId)||!id(input.campaignId)||!Number.isSafeInteger(input.expectedVersion)||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300||input.caseId!==caseId)fail('CUSTOMER_COMPENSATION_INVALID',400);
 const fingerprint=digest({actorId:actor.employeeId,input});
 if(saved){if(saved.requestId===input.requestId&&saved.requestDigest===fingerprint)return {recorded:true,replayed:true,cashRefundPerformed:false};fail('CUSTOMER_COMPENSATION_ALREADY_RECORDED');}
 if(closed(row)||row.version!==input.expectedVersion||row.appealReviewRequired||row.caseAppeals?.some(x=>['OPEN','REVIEW_REQUIRED'].includes(x.status)))fail('CUSTOMER_COMPENSATION_CASE_CHANGED');
 const campaignKey={discountId:input.campaignId},grantKey=benefitGrantKey(input.campaignId,order.userSub),[campaign,grant]=await Promise.all([get(C,campaignKey),get(BENEFIT_TABLE,grantKey)]);
 if(!campaign||!eligible(campaign,grant,order.userSub)||voucherState(campaign,grant,now)!=='AVAILABLE'||digest(campaign)!==input.campaignRevision||digest(grant)!==input.grantRevision)fail('CUSTOMER_COMPENSATION_VOUCHER_CHANGED');
 if(input.caseKey==='CUSTOMER_POST_DELIVERY'){const d=row.decisions?.at(-1);if(!d||d.outcome!=='ACCEPTED'||d.remedyAmountIqd!==campaign.benefit.amountIqd||row.state!=='REMEDY_PENDING')fail('CUSTOMER_COMPENSATION_CASE_CHANGED');}
 const amount=campaign.benefit.amountIqd;if(!Number.isSafeInteger(actor.approvalLimit)||actor.approvalLimit<amount)fail('EXCEPTION_APPROVAL_LIMIT',403);
 const at=new Date(now).toISOString(),link={...linkKey,kind:'CUSTOMER_BENEFIT_COMPENSATION',orderId:order.orderId,caseId,caseKey:input.caseKey,campaignId:campaign.discountId,title:campaign.title||campaign.name,amountIqd:amount,grantVersion:grant.version+1,campaignRevision:digest(campaign),requestId:input.requestId,requestDigest:fingerprint,actorId:actor.employeeId,reason:input.reason.trim(),createdAt:at,cashRefundPerformed:false,financialPosting:false};
 const grantNext={...grant,version:grant.version+1,compensationReference:{orderId:order.orderId,caseId,requestId:input.requestId,linkedAt:at},updatedAt:at};
 const ops=[ctx.guard(actor),checked('WizzOrders',ok,order),checked(H,ck,row),checked('WizzUser_users_staging',pk,profile),checked(C,campaignKey,campaign),{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#CUSTOMER#'+order.userSub,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:BENEFIT_TABLE,Item:grantNext,...fence(grant)}},{Put:{TableName:BENEFIT_TABLE,Item:link,ConditionExpression:'attribute_not_exists(pk)'}},{Put:{TableName:BENEFIT_TABLE,Item:{pk:'USER#'+order.userSub,orderId:order.orderId,sk:'COMPENSATION_EVENT#'+input.requestId,kind:'CUSTOMER_BENEFIT_COMPENSATION_EVENT',caseId,actorKind:'STAFF',actorId:actor.employeeId,action:'CUSTOMER_BENEFIT_COMPENSATION_RECORDED',createdAt:at,reason:input.reason.trim(),financialPosting:false,proof:{campaignId:campaign.discountId,amountIqd:amount,remedyKind:'FUTURE_GOODS_DISCOUNT',cashRefundPerformed:false}},ConditionExpression:'attribute_not_exists(pk)'}},ctx.audit(actor.employeeId,'CUSTOMER_BENEFIT_COMPENSATION_RECORDED',null,{orderId:order.orderId,caseId,campaignId:campaign.discountId,amountIqd:amount,cashRefundPerformed:false},input.requestId)];
 try{await ctx.db.send(new TransactWriteCommand({TransactItems:ops}));}catch(e){if(e.name==='TransactionCanceledException')fail('CUSTOMER_COMPENSATION_CASE_CHANGED');throw e;}
 return {recorded:true,replayed:false,cashRefundPerformed:false};
}
module.exports={route,voucherState,eligible};
