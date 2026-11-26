import {quoteEntityIdValid,quoteHash} from './deliveryQuoteRecord';
import {FinancialRow as Row} from './driverFinancialTransaction';
export const DISPATCH_RESPONSE_QUEUE='DISPATCH_RESPONSE_INTEGRATION';
export function dispatchResponseQueue(event:Row){
 const action=event.eventType==='ACCEPTED'?'ACCEPT':event.eventType==='DECLINED'?'DECLINE':null;
 if(!action||event.kind!=='DISPATCH_RESPONSE_OUTBOX'||![event.orderId,event.assignmentId,event.cycleId,event.offerId,event.driverId,event.subjectId,event.branchId].every(quoteEntityIdValid)||!Number.isSafeInteger(event.waveNumber)||event.waveNumber<1||event.waveNumber>1000||event.eventId!=='DR:'+quoteHash({cycle:event.cycleId,offerId:event.offerId,action}).slice(0,48)||event.SK!=='DISPATCH_RESPONSE#'+event.eventId||!Number.isFinite(Date.parse(event.createdAt))||new Date(event.createdAt).toISOString()!==event.createdAt)throw Error('DISPATCH_RESPONSE_PROOF_REQUIRED');
 const fields=['eventId','eventType','orderId','assignmentId','cycleId','offerId','driverId','subjectId','branchId','waveNumber','createdAt'];
 return {Put:{TableName:'staging-WalletLifecycle',Item:{...Object.fromEntries(fields.map(k=>[k,event[k]])),operationId:event.eventId+':EVENT',kind:'DISPATCH_RESPONSE_INTEGRATION',integrationSchemaVersion:1,status:'PENDING_INTEGRATION',queuePartition:DISPATCH_RESPONSE_QUEUE,nextAttemptAt:0,integrationAttempts:0},ConditionExpression:'attribute_not_exists(operationId)'}};
}
