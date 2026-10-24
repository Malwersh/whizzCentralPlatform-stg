import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {authenticateFinancialIdentity} from './financialIdentity';
import {createFinanceRollout} from './financeRollout';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {setFinancialFields} from './financialRelease';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const fail=(code='MERCHANT_HANDOVER_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export function createMerchantHandover({db,authenticate,now=Date.now}:any){return async(v:Row)=>{
 if(!v||Object.keys(v).sort().join(',')!=='attempt,branchId,idempotencyKey,offerId,orderId'||![v.orderId,v.branchId,v.offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(v.attempt)||v.attempt<1||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.idempotencyKey||''))return fail('INVALID_MERCHANT_HANDOVER');
 const actor=await authenticate(),key={PK:'ORDER#'+v.orderId,SK:'META'},order=await strongGet(db,'WizzOrders',key),bk={businessId:v.branchId},branch=await strongGet(db,'WhizzMerchants_Businesses',bk);
 if(actor.kind!=='MERCHANT_OWNER'||!branch||branch.ownerId!==actor.subjectId||branch.cognitoUserId!==actor.subjectId||branch.deletedAt!=null||branch.deletionRequestId!=null||branch.isDeleted===true||!order||order.orderId!==v.orderId||order.storeId!==v.branchId)return fail('FORBIDDEN');
 if(order.financialAcceptance?.offerId!==v.offerId||order.assignmentAttemptCounter!==v.attempt||!quoteEntityIdValid(order.driverId)||order.financialOutcome!=null||order.deletedAt!=null||order.deletionRequestId!=null||order.isDeleted===true)return fail();
 if(order.merchantHandover){if(order.merchantHandover.state!=='HANDED_TO_DRIVER'||order.merchantHandover.driverId!==order.driverId||order.merchantHandover.attempt!==v.attempt)return fail();return {success:true,orderId:v.orderId,handover:order.merchantHandover,replayed:true};}
 if(!['ready_for_pickup','assigned','accepted','heading_to_store','arrived_at_store'].includes(order.status)||order.pickedUpAt!=null||order.pickupAt!=null||order.returnCaseId!=null)return fail();
 const at=new Date(now()).toISOString(),record={state:'HANDED_TO_DRIVER',branchId:v.branchId,ownerId:actor.subjectId,driverId:order.driverId,attempt:v.attempt,offerId:v.offerId,recordedAt:at,idempotencyKey:v.idempotencyKey};
 const ops:Row[]=[exactCheck('WhizzMerchants_Businesses',bk,branch,[...new Set([...Object.keys(branch),'deletedAt','deletionRequestId','isDeleted'])]),setFinancialFields(exactCheck('WizzOrders',key,order,[...new Set([...Object.keys(order),'merchantHandover','pickedUpAt','pickupAt','financialOutcome'])]),{merchantHandover:record,updatedAt:at}),{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#HANDOVER#'+v.idempotencyKey,logId:'HANDOVER:'+v.idempotencyKey,action:'MERCHANT_HANDED_TO_DRIVER',actorId:actor.subjectId,actorKind:'MERCHANT_OWNER',orderId:v.orderId,driverId:order.driverId,branchId:v.branchId,createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}];
 for(const pk of ['ACCOUNT_LIFECYCLE#MERCHANT#'+actor.subjectId,'BUSINESS_LIFECYCLE#MERCHANT#'+v.branchId])ops.push({ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}});
 if(!equal(actor,await authenticate()))return fail('UNAUTHORIZED');
 try{await db.send(new TransactWriteCommand({TransactItems:ops as any,ClientRequestToken:quoteHash(ops).slice(0,36)}));}catch(e){const saved=await strongGet(db,'WizzOrders',key);if(saved?.merchantHandover?.idempotencyKey===v.idempotencyKey)return {success:true,orderId:v.orderId,handover:saved!.merchantHandover,replayed:true};throw e;}
 return {success:true,orderId:v.orderId,handover:record,replayed:false};
};}
export async function handler(event:Row){try{
 if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||event.action!=='merchant_handover'||typeof event.accessToken!=='string')return fail('UNAUTHORIZED');
 if(process.env.AWS_REGION!=='us-east-1'||(process.env.STAGE??process.env.ENVIRONMENT)!=='staging')return fail('MERCHANT_HANDOVER_DISABLED');
 const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw}),db=rollout.db,cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
 const authenticate=()=>authenticateFinancialIdentity(cognito,event.accessToken,'MERCHANT_OWNER');await authenticate();await rollout.order(event.body?.orderId,'DRAIN');const result=await createMerchantHandover({db,authenticate})(event.body);return {statusCode:200,result};
}catch(e:any){return {statusCode:e?.code==='UNAUTHORIZED'?401:409,code:e?.code||'MERCHANT_HANDOVER_CONFLICT'};}}
