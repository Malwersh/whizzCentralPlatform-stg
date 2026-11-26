'use strict';
const kinds=new Set(['TransactionCanceledException','TransactionConflictException','ValidationException','AccessDeniedException','TypeError','ReferenceError','Error']);
const reasons=new Set(['None','ConditionalCheckFailed','TransactionConflict','ProvisionedThroughputExceeded','ThrottlingError','ValidationError','ItemCollectionSizeLimitExceeded']);
function details(error,action){
 const name=kinds.has(error?.name)?error.name:'OtherError',message=typeof error?.message==='string'?error.message:'';
 const reserved=/reserved keyword:\s*([A-Za-z_][A-Za-z0-9_]*)/i.exec(message);
 const property=/reading ['"]([A-Za-z_][A-Za-z0-9_]*)['"]/.exec(message);
 return {action:typeof action==='string'&&/^[A-Z_]{1,80}$/.test(action)?action:'UNKNOWN',name,
  ...(reserved?{reservedKeyword:reserved[1]}:{}),...(property?{missingProperty:property[1]}:{}),
  hint:message.includes('not used in expressions')?'UNUSED_EXPRESSION_ATTRIBUTE':message.includes('removeUndefinedValues')?'UNDEFINED_VALUE':message.includes('multiple operations on one item')?'DUPLICATE_TRANSACTION_TARGET':null,
  cancellations:Array.isArray(error?.CancellationReasons)?error.CancellationReasons.map((r,index)=>({index,code:reasons.has(r?.Code)?r.Code:'Other'})):[],
  locations:typeof error?.stack==='string'?Array.from(error.stack.matchAll(/\/var\/task\/[A-Za-z0-9_./-]+:\d+:\d+/g),m=>m[0]).slice(0,5):[]};
}
function report(error,action){console.warn('ORDER_CASE_OPERATION_REJECTED',details(error,action));}
module.exports={details,report};
