const {dispatchOfferSK}=require('../../src/utils/dispatch-cycle-keys');
import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createStagingLegacyResponses} from './dispatchLegacy';
import {composeDispatchTransaction} from './dispatchTransaction';
import {strongGet,exactCheck,detach,equal,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
const JOBS='WizzDispatchJobs_staging',HOLDS='staging-Holds',WALLETS='staging-Wallets';
const bad=():never=>{throw Error('LEGACY_ACCEPTANCE_BRIDGE_CONFLICT');};
/** Durable orchestration around the EXISTING reservation and assignment writers.
 * No release callback exists: unknown does not mean rejected, expired or refundable.
 * reserve must be idempotent and bind metadata.pinnedDispatchAttemptId to attemptId.
 * Assignment stores ASSIGNED+receipt in its own winner transaction, never by trusting
 * an HTTP/Lambda success envelope. No client prices, amounts, actors or hold IDs.
 */
export function createStagingLegacyAcceptanceBridge(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 authenticateDriver:()=>Promise<{driverId:string;subjectId:string}>;
 reserve:(input:{orderId:string;driverId:string;amount:number;assignmentAttempt:1;attemptId:string})=>Promise<unknown>;
 assign?:(input:{orderId:string;offerId:string;waveNumber:number},attemptId:string)=>Promise<unknown>}){
 const {db}=options,now=options.now??Date.now;
 const service=createStagingLegacyResponses({db,now,authenticateDriver:options.authenticateDriver});
 const pending=(a:Row)=>({success:false,pending:true,code:'LEGACY_ACCEPTANCE_PENDING',requestId:a.attemptId,phase:a.state});
 const review=(a:Row)=>({success:false,pending:false,reviewRequired:true,code:'LEGACY_ACCEPTANCE_REVIEW_REQUIRED',requestId:a.attemptId});
 function result(a:Row,actor:Row,offer:Row){if(a.state!=='ASSIGNED')return null;const r=a.receipt;if(!r||r.success!==true||r.kind!=='PINNED_LEGACY_ACCEPTANCE'||r.driverId!==actor.driverId||r.subjectId!==actor.subjectId||r.offerId!==offer.offerId||r.orderId!==offer.orderId||r.acceptanceAttemptId!==a.attemptId||r.holdAmount!==a.amount||r.holdId!==a.holdId)return bad();return {...detach(r),replayed:true};}
 return {async accept(input:{orderId:string;offerId:string;waveNumber:number}){
  if(!input||Object.keys(input).sort().join(',')!=='offerId,orderId,waveNumber'||![input.orderId,input.offerId].every(quoteEntityIdValid)||!Number.isSafeInteger(input.waveNumber)||input.waveNumber<1)return bad();
  const actor=detach(await options.authenticateDriver());if(!actor||![actor.driverId,actor.subjectId].every(quoteEntityIdValid))return bad();
  const job=await strongGet(db,JOBS,{orderId:input.orderId,SK:'METADATA'});
  const cycle=require('./dispatchCycle').validateDispatchCycle(job?.dispatchCycle);
  const loadedOffer=await strongGet(db,'WaveOffers_staging',{orderId:input.orderId,SK:dispatchOfferSK(cycle,actor.driverId,input.waveNumber)});
  const offer:Row=loadedOffer??bad();
  if(offer.offerId!==input.offerId||offer.driverSubjectId!==actor.subjectId||offer.driverId!==actor.driverId||!quoteEntityIdValid(offer.dispatchCycleId)||typeof offer.legacyTermsDigest!=='string')return bad();
  const attemptId='LA:'+quoteHash({cycle:offer.dispatchCycleId,offerId:offer.offerId,driverId:actor.driverId,subjectId:actor.subjectId,digest:offer.legacyTermsDigest}).slice(0,48),key={orderId:input.orderId,SK:'DISPATCH_ACCEPTANCE#'+attemptId};
  function matches(a:Row){if(a.kind!=='LEGACY_ACCEPTANCE_ATTEMPT'||a.attemptId!==attemptId||a.orderId!==input.orderId||a.offerId!==input.offerId||a.waveNumber!==input.waveNumber||a.driverId!==actor.driverId||a.subjectId!==actor.subjectId||a.cycleId!==offer.dispatchCycleId||a.offerDigest!==offer.legacyTermsDigest||a.amount!==offer.holdRequiredAmount||!['RESERVATION_PENDING','ASSIGNMENT_PENDING','ASSIGNED','REVIEW_REQUIRED'].includes(a.state)||!Number.isSafeInteger(a.version)||a.version<1)return bad();return a;}
  async function read(){const a=await strongGet(db,JOBS,key);return a?matches(a):null;}
  async function write(next:Row,prior:Row|null,guards:Row[]=[]){const condition:Row=prior?{...exactCheck(JOBS,key,prior).ConditionCheck}:{ConditionExpression:'attribute_not_exists(orderId)'};delete condition.TableName;delete condition.Key;const tx=composeDispatchTransaction([{Put:{TableName:JOBS,Item:next,...condition}}],guards);
   // Put uses Item, never Key (the condition belongs to the existing item).
   const put=tx[0].Put;delete put.Key;
   try{await db.send(new TransactWriteCommand({TransactItems:tx as any,ClientRequestToken:quoteHash(tx).slice(0,36)}));return next;}catch{const saved=await read();if(!saved)throw Error('LEGACY_ACCEPTANCE_PENDING');return saved;}
  }
  async function inspect(){const checked=await service.inspect(input);if(checked.kind!=='LEGACY_ACCEPTANCE_INSPECTION'||!equal(checked.actor,actor)||checked.offer.legacyTermsDigest!==offer.legacyTermsDigest)return bad();return checked;}
  let a=await read();if(a){const completed=result(a,actor,offer);if(completed)return completed;if(a.state==='REVIEW_REQUIRED')return review(a);}
  if(!a){const checked=await service.inspect(input);if(checked.kind==='PINNED_LEGACY_ACCEPTANCE')return checked;if(!equal(checked.actor,actor)||checked.offer.legacyTermsDigest!==offer.legacyTermsDigest)return bad();
   a=await write({...key,kind:'LEGACY_ACCEPTANCE_ATTEMPT',attemptId,driverId:actor.driverId,subjectId:actor.subjectId,offerId:offer.offerId,waveNumber:input.waveNumber,cycleId:offer.dispatchCycleId,offerDigest:offer.legacyTermsDigest,amount:offer.holdRequiredAmount,state:'RESERVATION_PENDING',version:1,createdAt:new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString()},null,checked.guards);
  }
  if(result(a,actor,offer))return result(a,actor,offer)!;if(a.state==='REVIEW_REQUIRED')return review(a);
  if(a.state==='RESERVATION_PENDING'){
   let checked:Row;try{checked=await inspect();}catch{a=await write({...a,state:'REVIEW_REQUIRED',version:a.version+1,reason:'OFFER_OR_AUTHORIZATION_CHANGED',updatedAt:new Date(now()).toISOString()},a);return result(a,actor,offer)??(a.state==='REVIEW_REQUIRED'?review(a):pending(a));}
   let hold=await strongGet(db,HOLDS,{orderId:input.orderId,sk:'HOLD'});
   if(!hold&&a.amount>0){try{if(!equal(await options.authenticateDriver(),actor))return bad();await options.reserve({orderId:input.orderId,driverId:actor.driverId,amount:a.amount,assignmentAttempt:1,attemptId});}catch{/* the writer may have committed; read its durable result */}hold=await strongGet(db,HOLDS,{orderId:input.orderId,sk:'HOLD'});}
   if(a.amount>0&&!hold)return pending(a);
   const guards:Row[]=[...checked.guards];let holdId:null|string=null;
   if(a.amount>0){const wallet=typeof hold?.walletId==='string'?await strongGet(db,WALLETS,{walletId:hold.walletId,sk:'META'}):null;
    if(!hold||hold.status!=='ACTIVE'||hold.financialSchemaVersion!==undefined||hold.amount!==a.amount||hold.metadata?.assignmentAttempt!==1||hold.metadata?.pinnedDispatchAttemptId!==attemptId||!quoteEntityIdValid(hold.holdId)||!wallet||wallet.ownerId!==actor.driverId||wallet.ownerType!=='DRIVER'||wallet.status!=='ACTIVE'||wallet.currency!=='IQD'||wallet.deletionRequestId!=null||!Number.isSafeInteger(wallet.lockedBalance)||wallet.lockedBalance<a.amount||!Number.isSafeInteger(wallet.version)||wallet.version<1){a=await write({...a,state:'REVIEW_REQUIRED',version:a.version+1,reason:'RESERVATION_PROOF_CONFLICT',updatedAt:new Date(now()).toISOString()},a);return result(a,actor,offer)??(a.state==='REVIEW_REQUIRED'?review(a):pending(a));}
    holdId=hold.holdId;guards.push(exactCheck(HOLDS,{orderId:input.orderId,sk:'HOLD'},hold),exactCheck(WALLETS,{walletId:hold.walletId,sk:'META'},wallet,[...new Set([...Object.keys(wallet),'deletionRequestId'])]));
   }else if(hold){a=await write({...a,state:'REVIEW_REQUIRED',version:a.version+1,reason:'UNEXPECTED_RESERVATION',updatedAt:new Date(now()).toISOString()},a);return result(a,actor,offer)??review(a);}
   else guards.push({ConditionCheck:{TableName:HOLDS,Key:{orderId:input.orderId,sk:'HOLD'},ConditionExpression:'attribute_not_exists(orderId)'}});
   a=await write({...a,state:'ASSIGNMENT_PENDING',holdId,version:a.version+1,updatedAt:new Date(now()).toISOString()},a,guards);
  }
  const completed=result(a,actor,offer);if(completed)return completed;if(a.state==='REVIEW_REQUIRED')return review(a);if(a.state!=='ASSIGNMENT_PENDING')return pending(a);
  try{await inspect();}catch{a=await write({...a,state:'REVIEW_REQUIRED',version:a.version+1,reason:'OFFER_OR_AUTHORIZATION_CHANGED',updatedAt:new Date(now()).toISOString()},a);return result(a,actor,offer)??(a.state==='REVIEW_REQUIRED'?review(a):pending(a));}
  try{if(options.assign)await options.assign(input,attemptId);else await createStagingLegacyResponses({db,now,authenticateDriver:options.authenticateDriver,acceptanceAttemptId:attemptId}).respond('ACCEPT',input);}catch{/* never release on a failed or missing response */}
  a=(await read())!;return result(a,actor,offer)??(a.state==='REVIEW_REQUIRED'?review(a):pending(a));
 }};
}
