'use strict';
const assert=require('node:assert/strict');
const {service,hash}=require('../../commercial-management');
const {parseIqd}=require('../../pricing-runtime/money');
const {randomUUID}=require('node:crypto');
const P='staging-MerchantPlatform',S='staging-PlatformStaff',B='WhizzMerchants_Businesses';
const staff=(employeeId,role)=>({kind:'STAFF',actor:{employeeId,roles:[role],version:1,status:'ACTIVE',scope:{allRegions:true}}});
const editor=()=>staff('editor','commercial_editor'),approver=()=>staff('reviewer','commercial_approver'),owner={kind:'OWNER',sub:'owner'};
const rounding={incrementIqd:1,mode:'HALF_AWAY_FROM_ZERO'};
const charge=(kind)=>kind==='PERCENT'?{kind,basis:'AFTER_MERCHANT_DISCOUNT',fixed:null,rate:{numerator:10,denominator:100},rounding:'HALF_AWAY_FROM_ZERO',finalRounding:rounding}:{kind:'FIXED',basis:null,rate:null,fixed:parseIqd('500'),rounding:'EXACT',finalRounding:rounding};
const values=()=>({scope:'BRANCH',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,commission:charge('PERCENT'),serviceFee:charge('FIXED'),allowedFundingPolicyIds:[]});
function fixture(){
 const rows=new Map(),commands=[];const key=(table,k)=>table+'|'+JSON.stringify(Object.fromEntries(Object.entries(k).sort()));
 const put=(t,row)=>rows.set(key(t,t===B?{businessId:row.businessId}:t.endsWith('_Discounts')?{discountId:row.discountId}:{pk:row.pk,sk:row.sk}),structuredClone(row));
 const get=(t,k)=>structuredClone(rows.get(key(t,k)));
 put(B,{businessId:'branch',ownerId:'owner',cognitoUserId:'owner',organizationId:'merchant',status:'approved'});
 put(B,{businessId:'sibling',ownerId:'owner',cognitoUserId:'owner',organizationId:'merchant',status:'approved'});
 put(P,{pk:'PERSON#owner',sk:'ORGANIZATION#merchant',organizationId:'merchant',subjectId:'owner'});
 let broken=false,paged=false;
 const ctx={enabled:true,enrolled:true,claims:{},now:()=> '2026-10-16T12:00:00.000Z',recent:()=>{},employee:async()=>editor().actor,
 guard:a=>({ConditionCheck:{TableName:S,Key:{pk:'EMPLOYEE#'+a.employeeId,sk:'PROFILE'},ConditionExpression:'attribute_exists(pk)'}}),
 audit:(who,action,before,after,id)=>({Put:{TableName:S,Item:{pk:'AUDIT',sk:'2026-10-16T12:00:00.000Z#'+id,actorId:who,action,before,after}}})};
 ctx.db={send:async c=>{commands.push(c);const x=c.input,name=c.constructor.name;if(name==='GetCommand')return {Item:get(x.TableName,x.Key)};
 if(name==='QueryCommand')return paged?{Items:[],LastEvaluatedKey:{pk:'BRANCH#branch',sk:'COMMERCIAL#next'}}:{Items:[...rows.values()].filter(r=>r.pk===x.ExpressionAttributeValues[':pk']&&(x.ExpressionAttributeValues[':pk']==='AUDIT'?['COMMERCIAL_ACCEPT_AGREEMENT','COMMERCIAL_ACCEPT_FUNDING'].includes(r.action):r.sk.startsWith('COMMERCIAL#')))};
 if(name!=='TransactWriteCommand')throw Error(name);
 const touched=x.TransactItems.map(op=>{const o=Object.values(op)[0];return key(o.TableName,o.Key||(o.TableName===B?{businessId:o.Item.businessId}:o.TableName.endsWith('_Discounts')?{discountId:o.Item.discountId}:{pk:o.Item.pk,sk:o.Item.sk}));});assert.equal(new Set(touched).size,touched.length,'one operation per DynamoDB item');
 if(broken)throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});
 // Structural in-memory adapter. Real DynamoDB conditions require coordinated staging verification.
 for(const op of x.TransactItems){if(op.Put)put(op.Put.TableName,op.Put.Item);if(op.Update){const u=op.Update,r=get(u.TableName,u.Key);if(u.TableName===B&&u.ExpressionAttributeValues[':nextDeliveryRevision']!==undefined){r.deliveryOfferRevision=u.ExpressionAttributeValues[':nextDeliveryRevision'];if(u.ExpressionAttributeValues[':summaries']!==undefined)r.storefrontDeliveryAgreements=structuredClone(u.ExpressionAttributeValues[':summaries']);}else if(u.TableName===B)Object.assign(r,{commercialAgreementId:u.ExpressionAttributeValues[':aid'],commercialAgreementVersion:u.ExpressionAttributeValues[':av']});else Object.assign(r,{fundingPolicyId:u.ExpressionAttributeValues[':policy'],fundingPolicyVersion:u.ExpressionAttributeValues[':pv']});put(u.TableName,r);}}return {};}};
 return {ctx,put,get,commands,break:()=>broken=true,paginate:()=>paged=true};
}
const save=(v=values())=>({businessId:'branch',action:'SAVE_AGREEMENT',id:'contract',requestId:randomUUID(),draftVersion:0,baseVersion:0,businessIds:['branch'],values:v,reason:'اتفاقية الاختبار'});
const decision=(draft,action)=>({businessId:'branch',action,id:'contract',requestId:randomUUID(),draftVersion:draft.draftVersion,baseVersion:0,hash:draft.hash,...(action==='ACCEPT_AGREEMENT'?{}:{reason:'اعتماد الاختبار'})});
const call=(f,p,body)=>service(f.ctx,p,'POST',body);
module.exports={fixture,save,decision,owner,editor,approver,staff,values,call,P,S,B};
