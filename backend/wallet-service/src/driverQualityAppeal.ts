import {historicalFinancialOfferSK} from './financialOfferKey';
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {authenticateFinancialIdentity} from './financialIdentity';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
const {uuid,validCase,validDecision}=require('../../shared/driver-quality-proof-290');
type Row=Record<string,any>;
const fail=(code='DRIVER_QUALITY_REVIEW_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export function createDriverQualityAppeal(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<{kind:string;subjectId:string}>;now?:()=>number}){
 const {db,authenticate}=options,now=options.now??Date.now;
 return async(v:Row)=>{
  if(!v||Object.keys(v).sort().join(',')!=='action,expectedVersion,idempotencyKey,incidentId,orderId,reason'||v.action!=='APPEAL'||!quoteEntityIdValid(v.orderId)||!uuid(v.incidentId)||!uuid(v.idempotencyKey)||!Number.isSafeInteger(v.expectedVersion)||v.expectedVersion<1||typeof v.reason!=='string'||v.reason.trim().length<5||v.reason.length>1000)return fail('INVALID_DRIVER_QUALITY_REVIEW');
  const actor=await authenticate();if(actor.kind!=='DRIVER'||!quoteEntityIdValid(actor.subjectId))return fail('UNAUTHORIZED');
  const pk={driverId:actor.subjectId},profile=await strongGet(db,'WhizzDrivers_staging',pk);
  if(!profile||profile.driverId!==actor.subjectId||profile.isDeleted===true||profile.deletedAt!=null||profile.deletionRequestId!=null)return fail('UNAUTHORIZED');
  const ck={orderId:v.orderId,sk:'DRIVER_QUALITY#'+v.incidentId},row=await strongGet(db,'staging-Holds',ck);
  if(!row||row.driverId!==actor.subjectId)return fail('DRIVER_QUALITY_CASE_UNAVAILABLE');
  const offer=await strongGet(db,'WaveOffers_staging',{orderId:v.orderId,SK:await historicalFinancialOfferSK(db,v.orderId,actor.subjectId,row.wave,row.offerId,row.offerStorageKey)});
  if(!validCase(row,offer,actor.subjectId))return fail('DRIVER_QUALITY_CASE_UNAVAILABLE');
  const ek={orderId:v.orderId,sk:'QUALITY_REVIEW_EVENT#'+v.idempotencyKey},digest=quoteHash({...v,actorId:actor.subjectId}),prior=await strongGet(db,'staging-Holds',ek);
  if(prior){if(prior.requestDigest!==digest||prior.actorKind!=='DRIVER'||prior.actorId!==actor.subjectId)return fail();return {...prior.receipt,replayed:true};}
  const decisionEvent=row.decision?.id&&uuid(row.decision.id)?await strongGet(db,'staging-Holds',{orderId:v.orderId,sk:'QUALITY_REVIEW_EVENT#'+row.decision.id}):null;
  if(row.version!==v.expectedVersion||row.state!=='RESOLVED'||row.decision?.value!=='SUBSTANTIATED'||!validDecision(row,decisionEvent)||row.appeals.some((a:Row)=>a.status==='OPEN'))return fail('DRIVER_QUALITY_APPEAL_CONFLICT');
  if(row.history.length>=100||row.appeals.length>=30)return fail('DRIVER_QUALITY_REVIEW_LIMIT');
  const at=new Date(now()).toISOString(),appeal={id:v.idempotencyKey,status:'OPEN',againstDecisionId:row.decision.id,reference:'اعتراض مرسل من تطبيق السائق',reason:v.reason.trim(),createdAt:at,recordedBy:actor.subjectId,reportedByParty:'DRIVER'};
  const next={...row,version:row.version+1,state:'APPEAL_OPEN',updatedAt:at,appeals:[...row.appeals,appeal],history:[...row.history,{id:v.idempotencyKey,action:'SUBMIT_DRIVER_QUALITY_APPEAL',reason:v.reason.trim(),createdAt:at,actorId:actor.subjectId,decision:row.decision.value}]};
  if(Buffer.byteLength(JSON.stringify(next))>280000)return fail('DRIVER_QUALITY_REVIEW_LIMIT');
  const receipt={success:true,caseId:row.caseId,version:next.version,financialPosting:false,eligibilityEffect:'NONE',ratingEffect:'NONE'},event={...ek,kind:'DRIVER_QUALITY_REVIEW_EVENT',schemaVersion:1,recordId:v.idempotencyKey,caseId:row.caseId,orderId:v.orderId,driverId:actor.subjectId,offerId:row.offerId,attempt:row.attempt,sourceFingerprint:row.sourceFingerprint,action:'SUBMIT_DRIVER_QUALITY_APPEAL',actorKind:'DRIVER',actorId:actor.subjectId,requestDigest:digest,createdAt:at,receipt,financialPosting:false};
  const {Key:_key,...fence}=exactCheck('staging-Holds',ck,row).ConditionCheck;
  const index=await exceptionCaseIndexOperation(db,{caseId:row.caseId,orderId:v.orderId,caseKey:ck.sk,caseType:'DRIVER_QUALITY_REVIEW',state:'APPEAL_OPEN',open:true,at,branchId:row.branchId||offer!.branchId});
  if(!equal(actor,await authenticate()))return fail('UNAUTHORIZED');
  try{await db.send(new TransactWriteCommand({TransactItems:[exactCheck('WhizzDrivers_staging',pk,profile),exactCheck('WaveOffers_staging',{orderId:v.orderId,SK:await historicalFinancialOfferSK(db,v.orderId,actor.subjectId,row.wave,row.offerId,row.offerStorageKey)},offer!),exactCheck('staging-Holds',{orderId:v.orderId,sk:'QUALITY_REVIEW_EVENT#'+row.decision.id},decisionEvent!),{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+actor.subjectId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}},index,{Put:{...fence,Item:next}},{Put:{TableName:'staging-Holds',Item:event,ConditionExpression:'attribute_not_exists(orderId)'}},{Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+at.slice(0,10).replace(/-/g,''),sk:at+'#'+v.idempotencyKey,logId:v.idempotencyKey,action:'SUBMIT_DRIVER_QUALITY_APPEAL',caseId:row.caseId,orderId:v.orderId,actorKind:'DRIVER',actorId:actor.subjectId,createdAt:at,financialPosting:false},ConditionExpression:'attribute_not_exists(sk)'}}] as any}));}catch(error){const saved=await strongGet(db,'staging-Holds',ek);if(saved?.requestDigest===digest&&saved.actorId===actor.subjectId)return {...saved.receipt,replayed:true};throw error;}
  return receipt;
 };
}
export function createAuthenticatedDriverQualityAppeal(options:{db:Pick<DynamoDBDocumentClient,'send'>;cognito:Pick<CognitoIdentityProviderClient,'send'>;accessToken:string}){return createDriverQualityAppeal({db:options.db,authenticate:()=>authenticateFinancialIdentity(options.cognito,options.accessToken,'DRIVER')});}
