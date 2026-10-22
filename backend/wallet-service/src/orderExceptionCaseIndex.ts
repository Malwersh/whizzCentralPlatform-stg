import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {strongGet,exactCheck} from './driverFinancialTransaction';
export const CASE_OPEN_PARTITION='ORDER_EXCEPTIONS_OPEN';
/** Metadata pointer in the existing queue index, separate from retry-worker PENDING partition. */
export async function exceptionCaseIndexOperation(db:Pick<DynamoDBDocumentClient,'send'>,input:{caseId:string;orderId:string;caseKey:string;caseType:string;state:string;open:boolean;at:string;branchId:string;dueAt?:string}){
 const key={operationId:'EXCEPTION_CASE#'+input.caseId},old=await strongGet(db,'staging-WalletLifecycle',key);
 if(old&&(old.kind!=='ORDER_EXCEPTION_CASE_POINTER'||old.orderId!==input.orderId||old.caseKey!==input.caseKey||old.caseId!==input.caseId||!Number.isSafeInteger(old.version)))throw Error('EXCEPTION_CASE_INDEX_CONFLICT');
 const item={...key,...(old?{monitoringPhaseKey:old.monitoringPhaseKey,monitoringPhaseStartedAt:old.monitoringPhaseStartedAt,monitoringPriority:old.monitoringPriority,responseAlertAt:old.responseAlertAt,escalatedAt:old.escalatedAt,monitoringStatus:old.monitoringStatus}:{}),kind:'ORDER_EXCEPTION_CASE_POINTER',schemaVersion:1,caseId:input.caseId,orderId:input.orderId,branchId:input.branchId,caseKey:input.caseKey,caseType:input.caseType,status:input.open?'OPEN':'CLOSED',caseState:input.state,version:(old?.version??0)+1,queuePartition:input.open?CASE_OPEN_PARTITION:'ORDER_EXCEPTIONS_CLOSED',nextAttemptAt:Math.floor(Date.parse(input.dueAt??input.at)/1000),createdAt:old?.createdAt??input.at,updatedAt:input.at};
 if(!old)return {Put:{TableName:'staging-WalletLifecycle',Item:item,ConditionExpression:'attribute_not_exists(operationId)'}};
 const {Key:_key,...condition}=exactCheck('staging-WalletLifecycle',key,old).ConditionCheck;
 return {Put:{...condition,Item:item}};
}
