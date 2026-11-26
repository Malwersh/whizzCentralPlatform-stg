'use strict';
// References only. Recipient and current state are always read from the order.
function reference(value){
 if(!value||!['REQUESTED','CANCELLED','SUPERSEDED'].includes(value.state)||typeof value.requestId!=='string'||typeof value.caseId!=='string'||!Number.isSafeInteger(value.version)||value.version<1)return null;
 return {requestId:value.requestId,caseId:value.caseId,state:value.state,version:value.version};
}
function fromImage(image){const m=image?.exceptionCancellation?.M;return reference(m&&{requestId:m.requestId?.S,caseId:m.caseId?.S,state:m.state?.S,version:Number(m.version?.N)});}
async function send(order,expected,deliver){
 const ref=reference(order?.exceptionCancellation),hint=reference(expected),branch=order?.storeId||order?.businessId;
 if(!ref||!hint||!branch||ref.requestId!==hint.requestId||ref.caseId!==hint.caseId||ref.version<hint.version||order.isDeleted||order.deletedAt||order.deletionRequestId)return {skipped:true};
 const action=ref.state==='REQUESTED'?'customer_cancellation_requested':ref.state==='CANCELLED'?'order_cancellation_confirmed':'order_cancellation_updated';
 const result=await deliver({businessId:branch,orderId:order.orderId,orderNumber:order.orderNumber||order.orderId,action,status:order.status,cancellationState:ref.state,cancellationVersion:ref.version,cancellationRequestId:ref.requestId,caseId:ref.caseId,eventId:`cancellation:${order.orderId}:${ref.requestId}:${ref.version}`,updatedAt:order.updatedAt||order.createdAt});
 let body;try{body=typeof result.body==='string'?JSON.parse(result.body):result.body;}catch{throw Error('CANCELLATION_NOTICE_DELIVERY_FAILED');}
 if(result.statusCode!==200||body?.failureCount>0)throw Error('CANCELLATION_NOTICE_DELIVERY_FAILED');
 return {success:true,eventId:`cancellation:${order.orderId}:${ref.requestId}:${ref.version}`,tokensCount:body?.tokensCount??0};
}
module.exports={reference,fromImage,send};
