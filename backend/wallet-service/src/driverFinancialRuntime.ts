import {createStagingFinancialPushValidation} from './financialPushValidation';
import {createStagingFinancialOfferHydration} from './financialOfferHydration';
import {createFinanceRollout} from './financeRollout';
import {readDeliveryOperations} from './deliveryOperations';
import {validateOperationsSnapshot} from './deliveryOperationsPolicy';
import {strongGet} from './driverFinancialTransaction';
import {createStagingFinancialSearch} from './financialSearch';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createMapboxSecretReader } from './routingCredentials';
import { createMapboxRoadRouter } from './roadRouting';
import { createStagingDriverOfferContext } from './driverOfferContext';
import { createStagingDriverFinancialWave } from './driverFinancialWave';
import { createStagingDriverOfferAcceptance } from './driverOfferAcceptance';
import { createStagingCodReassignment } from './codReassignment';
import { createStagingCodReturn } from './codReturn';
import { authenticateFinancialIdentity } from './financialIdentity';
import { createStagingCodCompletion } from './codCompletion';
import { FinancialRow as Row } from './driverFinancialTransaction';
function configuration() {
 if(process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED'||process.env.STAGE!=='staging'||process.env.AWS_REGION!=='us-east-1')throw Error('FINANCIAL_DISPATCH_DISABLED');
 const ttl=Number(process.env.FINANCIAL_OFFER_TTL_SECONDS),age=Number(process.env.FINANCIAL_POSITION_MAX_AGE_SECONDS);
 if(![ttl,age].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=900))throw Error('FINANCIAL_DISPATCH_NOT_CONFIGURED');
 const deliveryFundingMode=process.env.FINANCIAL_DELIVERY_FUNDING_MODE??'OFF';
 if(!['OFF','REQUIRED'].includes(deliveryFundingMode))throw Error('DELIVERY_FUNDING_NOT_CONFIGURED');
 return {ttl,age,enableDeliveryFunding:deliveryFundingMode==='REQUIRED'};
}
function clients() {
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const rollout=createFinanceRollout({db});return {db:rollout.db,rollout,cognito:new CognitoIdentityProviderClient({region:'us-east-1'})};
}
export async function runFinancialWave(input:unknown,sendOffer:(driverId:string,message:Row)=>Promise<void>,selectionPolicy?:Row) {
 const config=configuration(),{db,cognito,rollout}=clients();
 const selector=input as Row;if(!selector||typeof selector.orderId!=='string'||!Number.isSafeInteger(selector.waveNumber))throw Error('INVALID_FINANCIAL_WAVE');
 await rollout.order(selector.orderId,'OFFER');for(const id of selector.driverIds??[])rollout.driver(selector.orderId,id);
 const savedWave=await strongGet(db,'WizzDispatchJobs_staging',{orderId:selector.orderId,SK:'FINANCIAL_WAVE#'+selector.waveNumber});
 const priorPolicy=selector.waveNumber>1?await strongGet(db,'WizzDispatchJobs_staging',{orderId:selector.orderId,SK:'FINANCIAL_WAVE#1'}):null;
 const operating=savedWave?{...(savedWave.operatingLimits?validateOperationsSnapshot(savedWave.operatingLimits):await readDeliveryOperations(db,{...process.env,DELIVERY_OPERATIONS_MODE:'ENV'})),condition:null}:priorPolicy?.operatingLimits?{...validateOperationsSnapshot(priorPolicy.operatingLimits),condition:null}:await readDeliveryOperations(db);
 if(selectionPolicy&&(selectionPolicy.version!==operating.version||JSON.stringify(selectionPolicy.values)!==JSON.stringify(operating.values)))throw Error('FINANCIAL_SELECTION_POLICY_CHANGED');
 config.ttl=operating.values.driverOfferTtlSeconds;config.age=operating.values.driverPositionMaxAgeSeconds;
 const getAccessToken=createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),
  secretArn:process.env.FINANCIAL_ROUTING_SECRET_ARN??'',accountId:'699561669180',region:'us-east-1',timeoutMs:1500});
 const router=createMapboxRoadRouter({getAccessToken,profile:'driving',ttlSeconds:config.ttl,timeoutMs:5000});
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,router,positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 return createStagingDriverFinancialWave({db,context,enableDeliveryFunding:config.enableDeliveryFunding,sendOffer:async(driverId,message)=>{await rollout.order(selector.orderId,'SEND');rollout.driver(selector.orderId,driverId);return sendOffer(driverId,message);},operating}).run(input);
}
export async function acceptFinancialOffer(body:Row,accessToken:string,decline=false) {
 const config=configuration(),{db,cognito,rollout}=clients();
 if(!body||Object.keys(body).some(k=>!['offerId','orderId','waveNumber','driverId'].includes(k)))throw Error('INVALID_FINANCIAL_ACCEPTANCE');
 await rollout.order(body.orderId,decline?'DRAIN':'ADMIT');
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,router:{async getRoute(){throw Error('ACCEPTANCE_MUST_NOT_REPRICE');}},
  positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 const service=createStagingDriverOfferAcceptance({db,context,enableDeliveryFunding:config.enableDeliveryFunding,contextForOffer:offer=>{
  const age=(Date.parse(offer.source.driver.expiresAt)-Date.parse(offer.source.driver.observedAt))/1000;
  if(!Number.isSafeInteger(age)||age<1||age>900)throw Error('FINANCIAL_ACCEPTANCE_CONFLICT');
  return createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,router:{async getRoute(){throw Error('ACCEPTANCE_MUST_NOT_REPRICE');}},positionMaxAgeSeconds:age,offerTtlSeconds:config.ttl});
 },authenticateDriver:async()=>{
  const identity=await authenticateFinancialDriver(cognito,accessToken,body);rollout.driver(body.orderId,identity.driverId,identity.subjectId);return identity;
 }});
 const selectors={orderId:body.orderId,offerId:body.offerId,waveNumber:body.waveNumber};
 return decline?service.decline(selectors):service.accept(selectors);
}

async function authenticateFinancialDriver(cognito:CognitoIdentityProviderClient,accessToken:string,body:Row) {
  const identity=await authenticateFinancialIdentity(cognito,accessToken,'DRIVER');
  if(body.driverId!==undefined&&body.driverId!==identity.subjectId)throw Error('UNAUTHORIZED');
  return {driverId:identity.subjectId,subjectId:identity.subjectId};
}
export async function completeFinancialCod(body:Row,accessToken:string) {
 const config=configuration();
 if(process.env.FINANCIAL_COD_COMPLETION_MODE!=='REQUIRED')throw Error('COD_COMPLETION_DISABLED');
 if(!body||Object.keys(body).some(k=>!['orderId','cashCollected','driverId'].includes(k)))throw Error('INVALID_COD_COMPLETION');
 const {db,cognito,rollout}=clients();
 return createStagingCodCompletion({db,enableDeliveryFunding:config.enableDeliveryFunding,authenticateDriver:async()=>{const actor=await authenticateFinancialDriver(cognito,accessToken,body);rollout.subject(body.orderId,actor.subjectId);return actor;}})
  .complete({orderId:body.orderId,cashCollected:body.cashCollected});
}

export async function financialCodReturn(action:string,body:Row,accessToken:string){
 const config=configuration();
 if(process.env.FINANCIAL_COD_RETURNS_MODE!=='REQUIRED')throw Error('COD_RETURNS_DISABLED');
 const {db,cognito,rollout}=clients(),owner=['read_return','confirm_return'].includes(action);
 const service=createStagingCodReturn({db,enableDeliveryFunding:config.enableDeliveryFunding,authenticate:async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,owner?'MERCHANT_OWNER':'DRIVER');if(!owner)rollout.subject(body.orderId,actor.subjectId);return actor;}});
 if(action==='request_return')return service.requestReturn(body);
 if(action==='arrive_return')return service.arriveReturn(body);
 if(action==='read_return')return service.readReturn(body);
 if(action==='confirm_return')return service.confirmReceipt(body);
 throw Error('INVALID_COD_RETURN');
}

export async function financialAssignmentTransition(action:string,body:Row,accessToken:string){
 const config=configuration();
 if(process.env.FINANCIAL_COD_ASSIGNMENTS_MODE!=='REQUIRED')throw Error('COD_ASSIGNMENTS_DISABLED');
 const {db,cognito,rollout}=clients(),owner=action==='cancel_before_pickup';
 const operating=await readDeliveryOperations(db,owner?{...process.env,DELIVERY_OPERATIONS_MODE:'ENV'}:process.env);
 const service=createStagingCodReassignment({db,enableDeliveryFunding:config.enableDeliveryFunding,reassignmentWindowSeconds:operating.values.reassignmentWindowSeconds,maximumWaves:operating.values.maximumWaves,operatingCondition:operating.condition,operatingVersion:operating.version,authenticate:async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,owner?'MERCHANT_OWNER':'DRIVER');if(!owner)rollout.subject(body.orderId,actor.subjectId);return actor;}});
 return owner?service.cancelBeforePickup(body):service.unassign(body);
}

export async function exhaustFinancialSearch(orderId:string) {
 const config=configuration();const {db}=clients();return createStagingFinancialSearch({db,enableDeliveryFunding:config.enableDeliveryFunding}).exhaust(orderId);
}

export async function expireFinancialWave(orderId:string,waveNumber:number) {
 const config=configuration(),{db,cognito}=clients();
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,router:{async getRoute(){throw Error('EXPIRY_MUST_NOT_REPRICE');}},
  positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 return createStagingDriverFinancialWave({db,context,enableDeliveryFunding:config.enableDeliveryFunding,sendOffer:async()=>{throw Error('EXPIRY_MUST_NOT_SEND');}}).expire(orderId,waveNumber);
}

export async function readFinancialOffer(body:Row,accessToken:string){
 const config=configuration(),{db,cognito,rollout}=clients();
 return createStagingFinancialOfferHydration({db,enableDeliveryFunding:config.enableDeliveryFunding,authenticate:()=>authenticateFinancialDriver(cognito,accessToken,{}),authorize:async reference=>{await rollout.order(reference.orderId,'DRAIN');rollout.driver(reference.orderId,reference.dispatchDriverId,reference.driverId);}})(body);
}

/** Internal Lambda invocation only. The financial service authenticates the original token itself;
 * a caller-supplied subject/hold/amount is never accepted. Never log event or credentials.
 */
export async function financialAcceptanceHandler(event:Row) {
 try {
  if(event?.action==='validate_push_reference'){if(Object.keys(event).sort().join(',')!=='action,body')throw Error('INVALID_FINANCIAL_ACCEPTANCE');configuration();const {db}=clients();return {statusCode:200,result:await createStagingFinancialPushValidation({db})(event.body)};}

  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||!['read_offer','accept','decline','complete_cod','request_return','arrive_return','read_return','confirm_return','unassign_financial','cancel_before_pickup'].includes(event.action)||typeof event.accessToken!=='string')throw Error('INVALID_FINANCIAL_ACCEPTANCE');
  const result=event.action==='read_offer'?await readFinancialOffer(event.body,event.accessToken):['unassign_financial','cancel_before_pickup'].includes(event.action)?await financialAssignmentTransition(event.action,event.body,event.accessToken):event.action.endsWith('_return')?await financialCodReturn(event.action,event.body,event.accessToken):event.action==='complete_cod'?await completeFinancialCod(event.body,event.accessToken):await acceptFinancialOffer(event.body,event.accessToken,event.action==='decline');
  return {statusCode:200,result};
 } catch(error:any) {
  const candidate=error?.code??error?.message;
  const allowed=['DELIVERY_FUNDING_NOT_CONFIGURED','FINANCE_ROLLOUT_OUT_OF_SCOPE','FINANCE_ROLLOUT_ADMISSION_CLOSED','FINANCE_ROLLOUT_NOT_CONFIGURED','COD_ASSIGNMENTS_DISABLED','COD_ASSIGNMENT_CONFLICT','COD_ASSIGNMENT_UNAVAILABLE','INVALID_COD_ASSIGNMENT','FORBIDDEN','COD_RETURNS_DISABLED','INVALID_COD_RETURN','COD_RETURN_CONFLICT','COD_CASH_REVIEW_REQUIRED','COD_RETURN_FUNDING_UNAVAILABLE','COD_RETURN_WALLET_UNAVAILABLE','COD_RETURN_UNAVAILABLE','COD_COMPLETION_DISABLED','INVALID_COD_COMPLETION','COD_COMPLETION_CONFLICT','COD_FUNDING_UNAVAILABLE','COD_WALLET_UNAVAILABLE','COD_AGREEMENT_REQUIRED','UNAUTHORIZED','FINANCIAL_DISPATCH_DISABLED','INVALID_FINANCIAL_ACCEPTANCE','FINANCIAL_ACCEPTANCE_CONFLICT','INSUFFICIENT_BALANCE','DRIVER_WALLET_UNAVAILABLE'];
  return {statusCode:candidate==='UNAUTHORIZED'?401:candidate==='FINANCE_ROLLOUT_NOT_CONFIGURED'?503:candidate?.startsWith('FINANCE_ROLLOUT_')?403:409,code:allowed.includes(candidate)?candidate:'FINANCIAL_ACCEPTANCE_UNAVAILABLE'};
 }
}
