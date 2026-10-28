'use strict';
const TARGET='staging-driver-performance-collector';
async function forwardOrderEvents(event,invoke){
 if(!Array.isArray(event?.Records))throw Error('INVALID_ORDER_PROJECTION_FORWARD');
 const Records=event.Records.map(r=>{
  if(r.eventSource!=='aws:dynamodb'||!/^arn:aws:dynamodb:us-east-1:699561669180:table\/WizzOrders\/stream\//.test(r.eventSourceARN)||!r.eventID||!r.dynamodb?.Keys)throw Error('INVALID_ORDER_PROJECTION_FORWARD');
  // Forward keys only. No names, addresses, order lines or money payload enters async retries/DLQ.
  return {eventSource:r.eventSource,eventSourceARN:r.eventSourceARN,eventName:r.eventName,eventID:r.eventID,dynamodb:{Keys:r.dynamodb.Keys,SequenceNumber:r.dynamodb.SequenceNumber}};
 });
 if(!Records.length)return;
 const result=await invoke({FunctionName:TARGET,InvocationType:'Event',Payload:Buffer.from(JSON.stringify({kind:'ORDER_FORWARD',Records}))});
 if(result.StatusCode!==202)throw Error('ORDER_PROJECTION_FORWARD_PENDING');
}
module.exports={forwardOrderEvents,TARGET};
