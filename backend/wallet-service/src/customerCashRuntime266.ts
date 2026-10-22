import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {createCustomerCashCase} from './customerCashCase';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {authenticateFinancialIdentity} from './financialIdentity';
import {createFinanceRollout} from './financeRollout';
export {createCustomerCashCase} from './customerCashCase';
export * from './customerCashReview';
type Row=Record<string,any>;
export const CUSTOMER_CASH_ACTIONS=['customer_cash_case','driver_cash_case','staff_cash_case'];
const SAFE_CODES=['CASH_ADJUDICATION_INVALID','CASH_ADJUDICATION_CHANGED','CASH_ADJUDICATION_BASIS_CHANGED','CASH_CONTACT_REQUIRED','CASH_ADJUSTMENT_EXCEEDS_PAYABLE','FULL_CASH_COMPLETION_CONFLICT','FULL_CASH_PARTY_UNAVAILABLE','FULL_CASH_WALLET_UNAVAILABLE','FULL_CASH_BUDGET_COMMITMENT_REQUIRED','UNAUTHORIZED','INVALID_CASH_REVIEW','CASH_REVIEW_CONFLICT','CASH_REVIEW_FORBIDDEN','CASH_REVIEW_PROOF_REQUIRED','CASH_REVIEW_UNAVAILABLE','CASH_REVIEW_CLOSED','CASH_REVIEW_LIMIT','CASH_REVIEW_MATCHING_REPORTS_REQUIRED','CASH_REVIEW_REFUNDS_ALREADY_RESERVED','CASH_REVIEW_NO_SHORTFALL','CASH_REVIEW_FINANCIAL_ADJUSTMENT_REQUIRED','REFUND_SOURCE_INVALID','REFUND_ALREADY_EXISTS','REFUND_EXCEEDS_COLLECTED','REFUND_SOURCE_NOT_ELIGIBLE','REFUND_STATE_CONFLICT','REFUND_EXECUTION_PROOF_REQUIRED','REFUND_CUSTODIAN_REQUIRED','REFUND_SOURCE_PROOF_CHANGED','REFUND_CUSTOMER_ACK_REQUIRED','REFUND_RECONCILIATION_REQUIRED','REFUND_COLLECTION_PROOF_CHANGED','PAYOUT_CASHBOX_UNAVAILABLE','PAYOUT_CASH_CUSTODIAN_REQUIRED','PAYOUT_CASH_OPENING_REQUIRED','PAYOUT_CASH_INSUFFICIENT','PAYOUT_CASH_COUNT_UNRESOLVED','PAYOUT_CASH_BALANCE_PROOF_INVALID','EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_EMPLOYEE_UNAVAILABLE','EXCEPTION_APPROVAL_LIMIT','EXCEPTION_CASE_POLICY_UNAVAILABLE','FINANCE_ROLLOUT_NOT_CONFIGURED','FINANCE_ROLLOUT_OUT_OF_SCOPE','FINANCE_ROLLOUT_ADMISSION_CLOSED','FINANCIAL_DISPATCH_DISABLED'];
/** Bounded staging entry for overlay deployments. Use a RAW SDK client here:
 * wrapping a previously scoped rollout DB twice would duplicate its transaction
 * aliases and invalidate every conditional money operation. */
export async function customerCashAcceptanceHandler(event:Row){
 try{
  if(process.env.FINANCIAL_DISPATCH_MODE!=='REQUIRED'||process.env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1'||(process.env.STAGE??process.env.ENVIRONMENT)!=='staging'||process.env.AWS_REGION!=='us-east-1')throw Error('FINANCIAL_DISPATCH_DISABLED');
  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||!CUSTOMER_CASH_ACTIONS.includes(event.action)||typeof event.accessToken!=='string')throw Error('INVALID_CASH_REVIEW');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
  return {statusCode:200,result:await createCustomerCashRuntime({db,cognito,accessToken:event.accessToken,action:event.action}).execute(event.body)};
 }catch(e:any){const code=e?.code??e?.message;return {statusCode:code==='UNAUTHORIZED'?401:code==='CASH_REVIEW_FORBIDDEN'||code==='EXCEPTION_PERMISSION_REQUIRED'?403:code==='FINANCE_ROLLOUT_NOT_CONFIGURED'?503:409,code:SAFE_CODES.includes(code)?code:'CASH_REVIEW_UNAVAILABLE'};}
}
/** Legacy return writers must neither read a disputed collection as unpaid nor
 * commit a clean return racing a newly opened payment case. Merge the fence into
 * their existing order operation, avoiding a duplicate DynamoDB transaction key. */
export function guardCashReviewReturnDb(db:Pick<DynamoDBDocumentClient,'send'>){
 return {async send(command:any){
  if(command?.input?.TransactItems){
   const input=structuredClone(command.input);input.TransactItems=input.TransactItems.map((op:Row)=>{
    const kind=op.Update?'Update':op.ConditionCheck?'ConditionCheck':null;if(!kind)return op;
    const q=op[kind];if(q.TableName!=='WizzOrders'||q.Key?.SK!=='META')return op;
    let alias='#cashReviewGuard',i=0;while(q.ExpressionAttributeNames?.[alias])alias='#cashReviewGuard'+(++i);
    let value=':cashReviewNull';i=0;while(q.ExpressionAttributeValues?.[value]!==undefined)value=':cashReviewNull'+(++i);
    let proofAlias='#cashCollectionGuard';i=0;while(q.ExpressionAttributeNames?.[proofAlias])proofAlias='#cashCollectionGuard'+(++i);
    q.ExpressionAttributeNames={...q.ExpressionAttributeNames,[alias]:'openPaymentClaimId',[proofAlias]:'cashReviewVerifiedCollection'};q.ExpressionAttributeValues={...q.ExpressionAttributeValues,[value]:null};
    const condition='(attribute_not_exists('+alias+') OR '+alias+'='+value+') AND (attribute_not_exists('+proofAlias+') OR '+proofAlias+'='+value+')';
    q.ConditionExpression=q.ConditionExpression?'('+q.ConditionExpression+') AND '+condition:condition;return op;
   });
   return db.send(new command.constructor(input));
  }
  const result:any=await db.send(command);
  if(command?.input?.TableName==='WizzOrders'&&(result?.Item?.openPaymentClaimId!=null||result?.Item?.cashReviewVerifiedCollection!=null))throw Object.assign(Error('COD_CASH_REVIEW_REQUIRED'),{code:'COD_CASH_REVIEW_REQUIRED'});
  return result;
 }};
}
/** Server action selects Cognito pool. There is no payload-selected actor or role. */
export function createCustomerCashRuntime(options:{db:Pick<DynamoDBDocumentClient,'send'>;
 cognito:Pick<CognitoIdentityProviderClient,'send'>;accessToken:string;action:string;now?:()=>number}){
 if(!CUSTOMER_CASH_ACTIONS.includes(options.action))throw Error('INVALID_CASH_REVIEW');
 const kind=options.action==='customer_cash_case'?'CUSTOMER':options.action==='driver_cash_case'?'DRIVER':'STAFF';
 const authority=createExceptionStaffAuthority(options),rollout=createFinanceRollout({db:options.db as DynamoDBDocumentClient});
 return {async execute(body:Row){
  // Validate the original token before a rollout/order read.
  const authenticate=async()=>{
   const actor=kind==='STAFF'?await authority.authenticate():await authenticateFinancialIdentity(options.cognito,options.accessToken,kind);
   await rollout.order(body?.orderId,'DRAIN');if(kind==='DRIVER')rollout.subject(body?.orderId,actor.subjectId);return actor;
  };
  return createCustomerCashCase({...options,db:rollout.db,authenticate,authorizeStaff:async(actor,mode,amount)=>{
   if(actor.kind!=='STAFF')throw Error('CASH_REVIEW_FORBIDDEN');const a={kind:'STAFF' as const,subjectId:actor.subjectId};
   const p=mode==='FINANCIAL'?await authority.financial(a,amount as number):mode==='EXECUTE'?await authority.executeCash(a):mode==='OPERATE'?await authority.operate(a):await authority.readCash(a);
   return [p.guard];
  }}).execute(body);
 }};
}
