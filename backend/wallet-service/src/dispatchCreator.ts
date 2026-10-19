import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {unmarshall} from '@aws-sdk/util-dynamodb';
import {createStagingDispatchCycleStore} from './dispatchCycleStore';
import {strongGet,FinancialRow as Row} from './driverFinancialTransaction';
import {quoteHash,quoteEntityIdValid} from './deliveryQuoteRecord';
/** Initial search only. Stable stream identity + minimal job input let replay
 * recover an invocation failure without recapturing mutable order/policy fields.
 * The existing cycle store supplies strong authorization/lifecycle write fences.
 */
export function createStagingDispatchCreator(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;enableDeliveryFunding?:boolean;invokeStart:(input:{orderId:string;dispatchJobId:string;cycleId:string})=>Promise<void>}) {
 const store=createStagingDispatchCycleStore(options);
 return {async process(record:Row){
  if(!record||record.eventSource!=='aws:dynamodb'||typeof record.eventSourceARN!=='string'||!/^arn:aws:dynamodb:us-east-1:699561669180:table\/WizzOrders\/stream\/[A-Za-z0-9_.:-]+$/.test(record.eventSourceARN))throw Error('INVALID_DISPATCH_STREAM_SOURCE');
  if(record.eventName!=='MODIFY')return {skipped:true,reason:'NOT_MODIFY'};
  const d=record.dynamodb;if(!d?.NewImage||!d.OldImage||typeof record.eventID!=='string'||!record.eventID||record.eventID.length>1024||typeof d.SequenceNumber!=='string'||!/^\d{1,100}$/.test(d.SequenceNumber))throw Error('INVALID_DISPATCH_STREAM_RECORD');
  const next=unmarshall(d.NewImage),prior=unmarshall(d.OldImage),keys=unmarshall(d.Keys??{});
  if(next.SK!=='META'||keys.SK!=='META')return {skipped:true,reason:'NOT_ORDER_META'};
  const orderId=next.orderId;
  if(!quoteEntityIdValid(orderId)||next.PK!=='ORDER#'+orderId||keys.PK!==next.PK)throw Error('INVALID_DISPATCH_STREAM_ORDER');
  const states=[next.status,next.orderStatus].filter(v=>v!==undefined);
  if(!states.length||states.some(s=>s!=='ready_for_pickup')||[prior.status,prior.orderStatus].includes('ready_for_pickup'))return {skipped:true,reason:'NOT_INITIAL_READY_TRANSITION'};
  if(next.financialSearch?.reviewStatus==='REQUIRED'||next.deliveryJobId!=null)return {skipped:true,reason:'EXISTING_SEARCH'};
  if(next.financialRelease!=null||(Array.isArray(next.excludedDrivers)&&next.excludedDrivers.length))throw Error('UNIFIED_REASSIGNMENT_NOT_READY');
  const branchId=next.storeId??next.businessId;
  if(!quoteEntityIdValid(branchId)||[next.storeId,next.businessId].some(v=>v!==undefined&&v!==branchId))throw Error('INVALID_DISPATCH_STREAM_BRANCH');
  const token=quoteHash({source:record.eventSourceARN,eventId:record.eventID,sequence:d.SequenceNumber,orderId});
  const requestId='DC:'+token,dispatchJobId='DISPATCH:'+token;
  const receipt=await store.create({requestId,job:{orderId,SK:'METADATA',dispatchJobId,restaurantId:branchId,status:'searching',currentWaveNumber:0}});
  const job=await strongGet(options.db,'WizzDispatchJobs_staging',{orderId,SK:'METADATA'});
  if(job?.dispatchJobId!==dispatchJobId||job.dispatchCycle?.id!==requestId)throw Error('DISPATCH_CREATION_SUPERSEDED');
  await options.invokeStart({orderId,dispatchJobId,cycleId:requestId});
  return {...receipt,startInvoked:true};
 }};
}
