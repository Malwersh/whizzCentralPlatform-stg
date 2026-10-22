import {createReturnContinuation} from './returnContinuation';
import {createReturnCustodyReconciler} from './returnCustody';
import {createReturnOperations,createReturnRoadRouter} from './returnOperations';
import {createReturnDisposition} from './returnDisposition';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {createExceptionCaseAdministration} from './exceptionCaseAdministration';
import {createCustomerCancellation} from './customerCancellation';
import {createDeliveryAttempt} from './deliveryAttempt';
import {createFullCashCompletion} from './fullCashCompletion';
import {financialWaveSK} from './financialDispatchKeys';
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
 if(process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED'||(process.env.STAGE??process.env.ENVIRONMENT)!=='staging'||process.env.AWS_REGION!=='us-east-1')throw Error('FINANCIAL_DISPATCH_DISABLED');
 const ttl=Number(process.env.FINANCIAL_OFFER_TTL_SECONDS),age=Number(process.env.FINANCIAL_POSITION_MAX_AGE_SECONDS);
 if(![ttl,age].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=900))throw Error('FINANCIAL_DISPATCH_NOT_CONFIGURED');
 const deliveryFundingMode=process.env.FINANCIAL_DELIVERY_FUNDING_MODE??'OFF';
 if(!['OFF','REQUIRED'].includes(deliveryFundingMode))throw Error('DELIVERY_FUNDING_NOT_CONFIGURED');
 const model=process.env.FINANCIAL_SETTLEMENT_MODEL??'LEGACY';
 if(!['LEGACY','FULL_CASH_AT_DELIVERY_V1'].includes(model))throw Error('FINANCIAL_SETTLEMENT_NOT_CONFIGURED');
 return {ttl,age,enableFullCash:model==='FULL_CASH_AT_DELIVERY_V1',enableDeliveryFunding:deliveryFundingMode==='REQUIRED'};
}
function clients() {
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}});
 const rollout=createFinanceRollout({db});return {db:rollout.db,rollout,cognito:new CognitoIdentityProviderClient({region:'us-east-1'})};
}
export async function runFinancialWave(input:unknown,sendOffer:(driverId:string,message:Row)=>Promise<void>,selectionPolicy?:Row) {
 const config=configuration(),{db,cognito,rollout}=clients();
 const selector=input as Row;if(!selector||typeof selector.orderId!=='string'||!Number.isSafeInteger(selector.waveNumber))throw Error('INVALID_FINANCIAL_WAVE');
 await rollout.order(selector.orderId,'OFFER');for(const id of selector.driverIds??[])rollout.driver(selector.orderId,id);
 const selectedJob=await strongGet(db,'WizzDispatchJobs_staging',{orderId:selector.orderId,SK:'METADATA'});
 const savedWave=await strongGet(db,'WizzDispatchJobs_staging',{orderId:selector.orderId,SK:financialWaveSK(selectedJob,selector.waveNumber)});
 const priorPolicy=selector.waveNumber>1?await strongGet(db,'WizzDispatchJobs_staging',{orderId:selector.orderId,SK:financialWaveSK(selectedJob,1)}):null;
 const operating=savedWave?{...(savedWave.operatingLimits?validateOperationsSnapshot(savedWave.operatingLimits):await readDeliveryOperations(db,{...process.env,DELIVERY_OPERATIONS_MODE:'ENV'})),condition:null}:priorPolicy?.operatingLimits?{...validateOperationsSnapshot(priorPolicy.operatingLimits),condition:null}:await readDeliveryOperations(db);
 if(selectionPolicy&&(selectionPolicy.version!==operating.version||JSON.stringify(selectionPolicy.values)!==JSON.stringify(operating.values)))throw Error('FINANCIAL_SELECTION_POLICY_CHANGED');
 config.ttl=operating.values.driverOfferTtlSeconds;config.age=operating.values.driverPositionMaxAgeSeconds;
 const getAccessToken=createMapboxSecretReader({secrets:new SecretsManagerClient({region:'us-east-1'}),
  secretArn:process.env.FINANCIAL_ROUTING_SECRET_ARN??'',accountId:'699561669180',region:'us-east-1',timeoutMs:1500});
 const router=createMapboxRoadRouter({getAccessToken,profile:'driving',ttlSeconds:config.ttl,timeoutMs:5000});
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,router,positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 return createStagingDriverFinancialWave({db,context,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,sendOffer:async(driverId,message)=>{await rollout.order(selector.orderId,'SEND');rollout.driver(selector.orderId,driverId);return sendOffer(driverId,message);},operating}).run(input);
}
export async function acceptFinancialOffer(body:Row,accessToken:string,decline=false) {
 const config=configuration(),{db,cognito,rollout}=clients();
 if(!body||Object.keys(body).some(k=>!['offerId','orderId','waveNumber','driverId'].includes(k)))throw Error('INVALID_FINANCIAL_ACCEPTANCE');
 await rollout.order(body.orderId,decline?'DRAIN':'ADMIT');
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,router:{async getRoute(){throw Error('ACCEPTANCE_MUST_NOT_REPRICE');}},
  positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 const service=createStagingDriverOfferAcceptance({db,context,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,contextForOffer:offer=>{
  const age=(Date.parse(offer.source.driver.expiresAt)-Date.parse(offer.source.driver.observedAt))/1000;
  if(!Number.isSafeInteger(age)||age<1||age>900)throw Error('FINANCIAL_ACCEPTANCE_CONFLICT');
  return createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,router:{async getRoute(){throw Error('ACCEPTANCE_MUST_NOT_REPRICE');}},positionMaxAgeSeconds:age,offerTtlSeconds:config.ttl});
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
 await rollout.order(body.orderId,'DRAIN');
 const authenticateDriver=async()=>{const actor=await authenticateFinancialDriver(cognito,accessToken,body);rollout.subject(body.orderId,actor.subjectId);return actor;};
 const order=await strongGet(db,'WizzOrders',{PK:'ORDER#'+body.orderId,SK:'META'});
 const service=order?.financialSnapshot?.schemaVersion===3
  ?createFullCashCompletion({db,enabled:config.enableFullCash,authenticateDriver})
  :createStagingCodCompletion({db,enableDeliveryFunding:config.enableDeliveryFunding,authenticateDriver});
 return service.complete({orderId:body.orderId,cashCollected:body.cashCollected});
}

export async function financialCodReturn(action:string,body:Row,accessToken:string){
 const config=configuration();
 if(process.env.FINANCIAL_COD_RETURNS_MODE!=='REQUIRED')throw Error('COD_RETURNS_DISABLED');
 const {db,cognito,rollout}=clients(),owner=['read_return','confirm_return','consent_return','set_return_acceptance','return_case_owner'].includes(action);
 const authenticate=async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,owner?'MERCHANT_OWNER':'DRIVER');await rollout.order(body.orderId,'DRAIN');if(!owner)rollout.subject(body.orderId,actor.subjectId);return actor;};
 if(['return_case_owner','return_case_driver'].includes(action))return createReturnContinuation({db,authenticate,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash}).execute(body,owner?'MERCHANT_OWNER':'DRIVER');
 const operations=createReturnOperations({db,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,authenticate});
 if(action==='set_return_acceptance')return operations.setAcceptance(body);
 if(action==='report_return_obstacle')return operations.reportObstacle(body);
 const returnRouter=createReturnRoadRouter();
 const service=createStagingCodReturn({db,returnRouter,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,authenticate:async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,owner?'MERCHANT_OWNER':'DRIVER');await rollout.order(body.orderId,'DRAIN');if(!owner)rollout.subject(body.orderId,actor.subjectId);return actor;}});
 if(action==='request_return')return service.requestReturn(body);
 if(action==='arrive_return')return service.arriveReturn(body);
 if(action==='read_return')return service.readReturn(body);
 if(action==='confirm_return')return service.confirmReceipt(body);
 if(action==='consent_return')return createReturnDisposition({db,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding,authenticate:async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,'MERCHANT_OWNER');await rollout.order(body.orderId,'DRAIN');return actor;}}).recordReadiness(body);
 throw Error('INVALID_COD_RETURN');
}

/** AWS IAM invocation only; not an action accepted by any customer/driver HTTP proxy.
 * Runs a deterministic, nonfinancial repair from an existing authenticated owner receipt. */
export async function reconcileVerifiedReturnReceipt(event:Row){
 configuration();if(process.env.FINANCIAL_COD_RETURNS_MODE!=='REQUIRED'||!event||Object.keys(event).sort().join(',')!=='action,caseKey,orderId'||event.action!=='reconcile_return_receipt')throw Error('INVALID_RETURN_RECONCILIATION');
 const {db,rollout}=clients();await rollout.order(event.orderId,'DRAIN');const result=await createReturnCustodyReconciler({db})(event.orderId,event.caseKey);return {success:true,...result};
}

export async function financialExceptionCaseAdmin(body:Row,accessToken:string){
 const config=configuration(),{db,cognito,rollout}=clients();
 const authority=createExceptionStaffAuthority({db,cognito,accessToken});
 await authority.authenticate();await rollout.order(body?.orderId,'DRAIN');
 return createExceptionCaseAdministration({db,authority,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding})(body);
}

export async function financialMerchantCancellation(body:Row,accessToken:string){
 const config=configuration(),{db,cognito,rollout}=clients();
 const authenticate=async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,'MERCHANT_OWNER');await rollout.order(body?.orderId,'DRAIN');return actor;};
 await authenticate();
 if(!body||Object.keys(body).sort().join(',')!=='branchId,cashCollected,goodsRetainedByBranch,idempotencyKey,orderId,preparationState,reason')throw Error('INVALID_CANCELLATION');
 const order=await strongGet(db,'WizzOrders',{PK:'ORDER#'+body.orderId,SK:'META'});if(!order)throw Error('CANCELLATION_UNAVAILABLE');
 if(order.financialAcceptance){return createStagingCodReassignment({db,authenticate,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding,reassignmentWindowSeconds:120,merchantCancellation:{reason:body.reason,preparationState:body.preparationState,idempotencyKey:body.idempotencyKey}}).cancelBeforePickup({orderId:body.orderId,branchId:body.branchId,offerId:order.financialAcceptance.offerId,attempt:order.assignmentAttemptCounter,goodsRetainedByBranch:body.goodsRetainedByBranch,cashCollected:body.cashCollected});}
 return createCustomerCancellation({db,authenticate,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding}).merchantCancelUnassigned(body);
}

export async function financialCustomerCancellation(action:string,body:Row,accessToken:string){
 const config=configuration(),{db,cognito,rollout}=clients();
 const authenticate=async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,['confirm_customer_cancellation','read_merchant_cancellation','record_merchant_cancellation_retention'].includes(action)?'MERCHANT_OWNER':'CUSTOMER');await rollout.order(body.orderId,'DRAIN');return actor;};
 const service=createCustomerCancellation({db,authenticate,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding});
 if(action==='record_merchant_cancellation_retention')return service.recordMerchantRetention(body);
 if(action==='confirm_customer_cancellation')return service.confirmNoPreparation(body);
 if(action==='read_merchant_cancellation'){if(!body||Object.keys(body).sort().join(',')!=='branchId,orderId')throw Error('INVALID_CANCELLATION');return service.read(body.orderId,body.branchId);}
 if(action==='read_customer_cancellation'){if(!body||Object.keys(body).join(',')!=='orderId')throw Error('INVALID_CANCELLATION');return service.read(body.orderId);}
 return service.request(body);
}

export async function financialDeliveryAttempt(action:string,body:Row,accessToken:string){
 const config=configuration();if(process.env.FINANCIAL_COD_RETURNS_MODE!=='REQUIRED')throw Error('COD_RETURNS_DISABLED');const {db,cognito,rollout}=clients();
 const authenticate=async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,'DRIVER');await rollout.order(body.orderId,'DRAIN');rollout.subject(body.orderId,actor.subjectId);return actor;};
 const service=createDeliveryAttempt({db,authenticate,enableFullCash:config.enableFullCash,enableDeliveryFunding:config.enableDeliveryFunding});
 if(action==='start_delivery_attempt')return service.start(body);
 if(action==='read_delivery_attempt')return service.read(body);
 if(action==='record_contact_attempt')return service.contact(body);
 throw Error('INVALID_DELIVERY_ATTEMPT');
}

export async function financialAssignmentTransition(action:string,body:Row,accessToken:string){
 const config=configuration();
 if(process.env.FINANCIAL_COD_ASSIGNMENTS_MODE!=='REQUIRED')throw Error('COD_ASSIGNMENTS_DISABLED');
 const {db,cognito,rollout}=clients(),owner=action==='cancel_before_pickup';
 const operating=await readDeliveryOperations(db,owner?{...process.env,DELIVERY_OPERATIONS_MODE:'ENV'}:process.env);
 const service=createStagingCodReassignment({db,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,reassignmentWindowSeconds:operating.values.reassignmentWindowSeconds,maximumWaves:operating.values.maximumWaves,operatingCondition:operating.condition,operatingVersion:operating.version,authenticate:async()=>{const actor=await authenticateFinancialIdentity(cognito,accessToken,owner?'MERCHANT_OWNER':'DRIVER');await rollout.order(body.orderId,'DRAIN');if(!owner)rollout.subject(body.orderId,actor.subjectId);return actor;}});
 return owner?service.cancelBeforePickup(body):service.unassign(body);
}

export async function exhaustFinancialSearch(orderId:string) {
 const config=configuration();const {db}=clients();return createStagingFinancialSearch({db,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash}).exhaust(orderId);
}

export async function expireFinancialWave(orderId:string,waveNumber:number) {
 const config=configuration(),{db,cognito}=clients();
 const context=createStagingDriverOfferContext({db,cognito,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,router:{async getRoute(){throw Error('EXPIRY_MUST_NOT_REPRICE');}},
  positionMaxAgeSeconds:config.age,offerTtlSeconds:config.ttl});
 return createStagingDriverFinancialWave({db,context,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,sendOffer:async()=>{throw Error('EXPIRY_MUST_NOT_SEND');}}).expire(orderId,waveNumber);
}

export async function financialCustomerCashCase(action:string,body:Row,accessToken:string){
 const config=configuration();if(!config.enableFullCash)throw Error('FULL_CASH_COMPLETION_DISABLED');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
 return require('./customerCashRuntime266').createCustomerCashRuntime({db,cognito,accessToken,action}).execute(body);
}

export async function readFinancialOffer(body:Row,accessToken:string){
 const config=configuration(),{db,cognito,rollout}=clients();
 return createStagingFinancialOfferHydration({db,enableDeliveryFunding:config.enableDeliveryFunding,enableFullCash:config.enableFullCash,authenticate:()=>authenticateFinancialDriver(cognito,accessToken,{}),authorize:async reference=>{await rollout.order(reference.orderId,'DRAIN');rollout.driver(reference.orderId,reference.dispatchDriverId,reference.driverId);}})(body);
}

/** Internal Lambda invocation only. The financial service authenticates the original token itself;
 * a caller-supplied subject/hold/amount is never accepted. Never log event or credentials.
 */
export async function financialAcceptanceHandler(event:Row) {
 if(event?.action==='reconcile_return_receipt'){try{return {statusCode:200,result:await reconcileVerifiedReturnReceipt(event)};}catch{return {statusCode:409,code:'RETURN_CUSTODY_CONFLICT'};}}
 try {
  if(event?.action==='validate_push_reference'){if(Object.keys(event).sort().join(',')!=='action,body')throw Error('INVALID_FINANCIAL_ACCEPTANCE');configuration();const {db}=clients();return {statusCode:200,result:await createStagingFinancialPushValidation({db})(event.body)};}

  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||!['customer_cash_case','driver_cash_case','staff_cash_case','merchant_cancel_before_pickup','exception_case_admin','read_offer','accept','decline','complete_cod','request_return','arrive_return','read_return','confirm_return','consent_return','set_return_acceptance','return_case_owner','return_case_driver','report_return_obstacle','read_customer_cancellation','request_customer_cancellation','confirm_customer_cancellation','read_merchant_cancellation','record_merchant_cancellation_retention','unassign_financial','cancel_before_pickup','start_delivery_attempt','read_delivery_attempt','record_contact_attempt'].includes(event.action)||typeof event.accessToken!=='string')throw Error('INVALID_FINANCIAL_ACCEPTANCE');
  const result=['customer_cash_case','driver_cash_case','staff_cash_case'].includes(event.action)?await financialCustomerCashCase(event.action,event.body,event.accessToken):event.action==='merchant_cancel_before_pickup'?await financialMerchantCancellation(event.body,event.accessToken):event.action==='exception_case_admin'?await financialExceptionCaseAdmin(event.body,event.accessToken):['read_customer_cancellation','request_customer_cancellation','confirm_customer_cancellation','read_merchant_cancellation','record_merchant_cancellation_retention'].includes(event.action)?await financialCustomerCancellation(event.action,event.body,event.accessToken):['start_delivery_attempt','read_delivery_attempt','record_contact_attempt'].includes(event.action)?await financialDeliveryAttempt(event.action,event.body,event.accessToken):event.action==='read_offer'?await readFinancialOffer(event.body,event.accessToken):['unassign_financial','cancel_before_pickup'].includes(event.action)?await financialAssignmentTransition(event.action,event.body,event.accessToken):(event.action.endsWith('_return')||['set_return_acceptance','report_return_obstacle','return_case_owner','return_case_driver'].includes(event.action))?await financialCodReturn(event.action,event.body,event.accessToken):event.action==='complete_cod'?await completeFinancialCod(event.body,event.accessToken):await acceptFinancialOffer(event.body,event.accessToken,event.action==='decline');
  return {statusCode:200,result};
 } catch(error:any) {
  const candidate=error?.code??error?.message;
  const allowed=["INVALID_CASH_REVIEW","CASH_REVIEW_CONFLICT","CASH_REVIEW_FORBIDDEN","CASH_REVIEW_PROOF_REQUIRED","CASH_REVIEW_UNAVAILABLE","CASH_REVIEW_CLOSED","CASH_REVIEW_LIMIT","CASH_REVIEW_MATCHING_REPORTS_REQUIRED","CASH_REVIEW_REFUNDS_ALREADY_RESERVED","CASH_REVIEW_NO_SHORTFALL","CASH_REVIEW_FINANCIAL_ADJUSTMENT_REQUIRED","REFUND_SOURCE_INVALID","REFUND_ALREADY_EXISTS","REFUND_EXCEEDS_COLLECTED","REFUND_SOURCE_NOT_ELIGIBLE","REFUND_STATE_CONFLICT","REFUND_EXECUTION_PROOF_REQUIRED","REFUND_CUSTODIAN_REQUIRED","REFUND_SOURCE_PROOF_CHANGED","REFUND_CUSTOMER_ACK_REQUIRED","REFUND_RECONCILIATION_REQUIRED","REFUND_COLLECTION_PROOF_CHANGED","PAYOUT_CASHBOX_UNAVAILABLE","PAYOUT_CASH_CUSTODIAN_REQUIRED","PAYOUT_CASH_OPENING_REQUIRED","PAYOUT_CASH_INSUFFICIENT","PAYOUT_CASH_COUNT_UNRESOLVED","PAYOUT_CASH_BALANCE_PROOF_INVALID","RETURN_CONTINUATION_CONFLICT","INVALID_RETURN_CONTINUATION","RETURN_ITEM_PLAN_REQUIRED","RETURN_ITEM_PLAN_LOCKED","RETURN_RECIPIENT_UNAVAILABLE","RETURN_RECIPIENT_REQUIRED","RETURN_HANDOVER_REQUIRED","RETURN_LOSS_FINDING_REQUIRED","RETURN_DISPOSAL_AUTHORIZATION_REQUIRED","RETURN_CUSTODY_WORK_REMAINS","CASE_APPEAL_ALREADY_OPEN","CASE_APPEAL_WINDOW_EXPIRED","EXCEPTION_APPEAL_PENDING","INVALID_RETURN_ITEM_PLAN","RETURN_ITEM_PLAN_CONFLICT","RETURN_ITEMS_INVALID","EXCEPTION_FINANCIAL_CONFLICT","INVALID_EXCEPTION_FINANCIAL_ACTION","EXCEPTION_FINANCIAL_CUSTODY_REQUIRED","EXCEPTION_FINANCIAL_FINDING_REQUIRED","EXCEPTION_FINANCIAL_APPROVAL_REQUIRED","EXCEPTION_ENTITLEMENTS_ALREADY_POSTED","EXCEPTION_GUARANTEE_ALLOCATION_INVALID","EXCEPTION_GUARANTEE_CHANGED","EXCEPTION_RETAINED_DEADLINE_REQUIRED","EXCEPTION_GUARANTEE_ALREADY_RESOLVED","EXCEPTION_WALLET_UNAVAILABLE","EXCEPTION_INSUFFICIENT_AVAILABLE_BALANCE","EXCEPTION_ENTITLEMENT_POLICY_CONFLICT","EXCEPTION_VERIFIED_ATTEMPT_REQUIRED","EXCEPTION_COMPENSATION_AGREEMENT_REQUIRED","EXCEPTION_FINANCIAL_WORK_REMAINS","EXCEPTION_MERCHANT_PAYOUT_PENDING","EXCEPTION_CLOSURE_CONFLICT",'INVALID_RETURN_GUARANTEE_REVIEW','RETURN_GUARANTEE_REVIEW_CONFLICT','RETURN_GUARANTEE_FINDING_REQUIRED','RETURN_CUSTODY_CONFLICT','RETURN_OPERATIONS_CONFLICT','INVALID_RETURN_OPERATIONS','RETURN_OBSTACLE_ALREADY_RECORDED','RETURN_OPERATIONS_UNAVAILABLE','INDEPENDENT_EVIDENCE_REQUIRED','EXCEPTION_FINDING_CONFLICT','INVALID_EXCEPTION_FINDING','EXCEPTION_EVIDENCE_REQUIRED','CANCELLATION_REASON_REQUIRED','INVALID_RETURN_DISPOSITION','RETURN_DISPOSITION_CONFLICT','RETURN_DISPOSITION_UNAVAILABLE','RETURN_BRANCH_READINESS_REQUIRED','INVALID_EXCEPTION_CASE_ACTION','EXCEPTION_CASE_CONFLICT','EXCEPTION_CASE_UNAVAILABLE','EXCEPTION_CASE_ACTION_NOT_ALLOWED','EXCEPTION_CASE_EVIDENCE_LIMIT','EXCEPTION_EMPLOYEE_UNAVAILABLE','EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_APPROVAL_LIMIT','CANCELLATION_RETAINED_PROOF_REQUIRED','EXCEPTION_CASE_POLICY_UNAVAILABLE','INVALID_EXCEPTION_CASE_POLICY','INVALID_CANCELLATION','CANCELLATION_CONFLICT','CANCELLATION_UNAVAILABLE','CANCELLATION_POLICY_REQUIRED','CANCELLATION_AFTER_PICKUP_OR_TERMINAL','CANCELLATION_ASSIGNED_REVIEW_REQUIRED','CANCELLATION_FINANCIAL_REVIEW_REQUIRED','CANCELLATION_PREPARATION_REVIEW_REQUIRED','INVALID_DELIVERY_ATTEMPT','DELIVERY_ATTEMPT_CONFLICT','ORDER_EXCEPTION_POLICY_REQUIRED','ARRIVAL_LOCATION_REQUIRED','ARRIVAL_LOCATION_STALE','ARRIVAL_OUTSIDE_RADIUS','CONTACT_ATTEMPT_TOO_SOON','NO_RESPONSE_REQUIREMENTS_NOT_MET','EXCEPTION_SETTINGS_UNAVAILABLE','INVALID_EXCEPTION_SETTINGS','FINANCIAL_SETTLEMENT_NOT_CONFIGURED','FULL_CASH_COMPLETION_DISABLED','INVALID_FULL_CASH_COMPLETION','FULL_CASH_COMPLETION_CONFLICT','FULL_CASH_WALLET_UNAVAILABLE','FULL_CASH_PARTY_UNAVAILABLE','FULL_CASH_BUDGET_COMMITMENT_REQUIRED','FULL_CASH_LEGACY_FUNDING_CONFLICT','FULL_CASH_AGREEMENT_REQUIRED','FULL_CASH_PRECISION_UNSUPPORTED','DELIVERY_FUNDING_NOT_CONFIGURED','FINANCE_ROLLOUT_OUT_OF_SCOPE','FINANCE_ROLLOUT_ADMISSION_CLOSED','FINANCE_ROLLOUT_NOT_CONFIGURED','COD_ASSIGNMENTS_DISABLED','COD_ASSIGNMENT_CONFLICT','COD_ASSIGNMENT_UNAVAILABLE','INVALID_COD_ASSIGNMENT','FORBIDDEN','COD_RETURNS_DISABLED','INVALID_COD_RETURN','COD_RETURN_CONFLICT','COD_CASH_REVIEW_REQUIRED','COD_RETURN_FUNDING_UNAVAILABLE','COD_RETURN_WALLET_UNAVAILABLE','COD_RETURN_UNAVAILABLE','COD_COMPLETION_DISABLED','INVALID_COD_COMPLETION','COD_COMPLETION_CONFLICT','COD_FUNDING_UNAVAILABLE','COD_WALLET_UNAVAILABLE','COD_AGREEMENT_REQUIRED','UNAUTHORIZED','FINANCIAL_DISPATCH_DISABLED','INVALID_FINANCIAL_ACCEPTANCE','FINANCIAL_ACCEPTANCE_CONFLICT','INSUFFICIENT_BALANCE','DRIVER_WALLET_UNAVAILABLE'];
  return {statusCode:candidate==='UNAUTHORIZED'?401:candidate==='FINANCE_ROLLOUT_NOT_CONFIGURED'?503:candidate?.startsWith('FINANCE_ROLLOUT_')?403:409,code:allowed.includes(candidate)?candidate:'FINANCIAL_ACCEPTANCE_UNAVAILABLE'};
 }
}
