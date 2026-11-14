'use strict';
// Forward committed status changes only. The receiver re-reads canonical order state.
const TARGET='wizzcentral-notifications-staging-pushSendOrderUpdate';
exports.forward=async(event,invoke)=>{
 const ids=new Map(),{fromImage}=require('./order-cancellation-notice');
 for(const r of event.Records||[]){
  if(!['INSERT','MODIFY'].includes(r.eventName)||r.eventSource!=='aws:dynamodb'||!r.eventSourceARN?.startsWith('arn:aws:dynamodb:us-east-1:699561669180:table/WizzOrders/stream/'))continue;
  const a=r.dynamodb?.NewImage,b=r.dynamodb?.OldImage,id=a?.orderId?.S;
  if(typeof id!=='string'||a?.PK?.S!=='ORDER#'+id||a?.SK?.S!=='META'||!a?.status?.S)continue;
  const next=fromImage(a),prior=fromImage(b),changed=next&&JSON.stringify(next)!==JSON.stringify(prior);
  if(r.eventName==='MODIFY'&&a.status.S===b?.status?.S&&a.returnStatus?.S===b?.returnStatus?.S&&!changed)continue;
  const previous=ids.get(id);
  ids.set(id,changed&&(!previous||next.version>=previous.version)?next:previous);
 }
 for(const [orderId,cancellationChange] of ids){
  const r=await invoke({FunctionName:TARGET,InvocationType:'Event',Payload:JSON.stringify({source:'wizz.order-activity-stream',schemaVersion:1,orderId,...(cancellationChange?{cancellationChange}:{})})});
  if(r.StatusCode!==202)throw Error('ORDER_ACTIVITY_ENQUEUE_FAILED');
 }
 return {queued:ids.size};
};
