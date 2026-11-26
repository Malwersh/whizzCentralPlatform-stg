'use strict';
const {createMerchantDevicePayoutAuthority,createMerchantPayoutApi,cashAccountingDeduplicate}=require('./settlement-runtime');
const {TransactWriteCommand}=require('@aws-sdk/lib-dynamodb'),{randomUUID}=require('crypto');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{code,status});};
async function handle(ctx,event){try{
 if(ctx.enabled!==true)fail('SETTLEMENT_SCHEDULE_ADMIN_DISABLED',503);
 if(Object.keys(event).sort().join(',')!=='action,deviceToken,httpMethod,input,staffSession'||typeof event.deviceToken!=='string'||typeof event.staffSession!=='string'||!event.input||typeof event.input!=='object'||Array.isArray(event.input))fail('PAYOUT_INVALID_REQUEST',400);
 const authorize=createMerchantDevicePayoutAuthority({db:ctx.db,deviceToken:event.deviceToken,staffSession:event.staffSession,method:event.httpMethod,input:event.input});
 const db=require('./settlement-orders').projectEvidenceDb(ctx.db),api=createMerchantPayoutApi({db,merchantStaff:{authorize},readAccount:body=>require('./merchant-account').read(ctx.db,body,true)});
 let result;if(event.httpMethod==='POST')result=await api.act(event.input);else{const {view,...body}=event.input;if(view==='payout-context')result=await api.merchantContext(body);else if(view==='merchant-account')result=await api.account(body);else if(view==='payouts')result=await api.list(body);else if(view==='payout')result=await api.details(body);else if(view==='payout-statement')result=await api.statement(body);else if(view==='payout-statements'&&Object.keys(body).every(k=>['branchId','cursor'].includes(k)))result=await api.statements(body.branchId,body.cursor);else fail('PAYOUT_PERMISSION_REQUIRED');}
 if(event.httpMethod==='GET'){const a=await authorize(event.input.branchId,'READ'),at=new Date().toISOString();await ctx.db.send(new TransactWriteCommand({TransactItems:cashAccountingDeduplicate([...a.guards,{Put:{TableName:'staging-MerchantPlatform',Item:{pk:'BRANCH#'+event.input.branchId,sk:'STAFF_AUDIT#SETTLEMENT#'+at+'#'+randomUUID(),kind:'MERCHANT_STAFF_SETTLEMENT_READ',action:event.input.view,businessId:event.input.branchId,ownerId:a.ownerId,actorId:a.actorId,actorName:a.merchantIdentity.name,roleName:a.merchantIdentity.roleLabel,membershipVersion:a.merchantIdentity.membershipVersion,policyVersion:a.merchantIdentity.policyVersion,deviceId:a.merchantIdentity.deviceId,createdAt:at,result:'SUCCEEDED'},ConditionExpression:'attribute_not_exists(pk)'}}])}));}
 return {statusCode:200,result};
 }catch(e){return {statusCode:e.status||(/^PAYOUT_/.test(e.code||'')?403:503),code:e.code||e.status&&e.message||'PAYOUT_UNAVAILABLE'};}}
module.exports={handle};
