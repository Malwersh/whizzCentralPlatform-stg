import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createFinanceRollout} from './financeRollout';
import {resumeMerchantPause} from './merchantPauseResume';
import {createMerchantPendingResponse} from './merchantPendingResponse';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {checkoutTables} from './checkoutTables';
import {isFinancialOrderProduction} from './walletBindings';
export async function handler(event:Row){
 if(process.env.MERCHANT_RESPONSE_MODE!=='REQUIRED')return {disabled:true};
 const production=isFinancialOrderProduction(process.env);
 const account=production?'746727375268':'699561669180';
 const stage=production?'production':'staging';
 if(process.env.STAGE!==stage||process.env.AWS_REGION!=='us-east-1'||process.env.FINANCIAL_COD_ACCOUNT_ID!==account)throw Error('MERCHANT_RESPONSE_NOT_CONFIGURED');
 const tables=checkoutTables();
 const scheduled=event.source==='aws.events'&&event.account===account&&event.region==='us-east-1'&&event['detail-type']==='Scheduled Event';
 const streamArn='arn:aws:dynamodb:us-east-1:'+account+':table/'+tables.orders+'/stream/';
 const streamRecords=Array.isArray(event.Records)?event.Records.filter((r:Row)=>r.eventName==='INSERT'&&r.eventSource==='aws:dynamodb'&&typeof r.eventSourceARN==='string'&&r.eventSourceARN.startsWith(streamArn)&&r.dynamodb?.NewImage?.merchantResponsePolicy?.M?.schemaVersion?.N==='1'&&typeof r.dynamodb?.NewImage?.orderId?.S==='string'):[];
 const streamed=!production&&event.source==='wizz.merchant-order-stream'&&typeof event.orderId==='string'&&!event.body&&!event.httpMethod;
 if(!scheduled&&!streamed&&!Array.isArray(event.Records))throw Error('INVALID_MERCHANT_RESPONSE_TRIGGER');
 const fundingMode=process.env.FINANCIAL_DELIVERY_FUNDING_MODE??'OFF';if(!['OFF','REQUIRED'].includes(fundingMode))throw Error('DELIVERY_FUNDING_NOT_CONFIGURED');
 const raw=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),rollout=createFinanceRollout({db:raw,merchantResponse:true}),db=rollout.db;
 let rows:Row[]=[];
 if(Array.isArray(event.Records)){for(const record of streamRecords){const r=await strongGet(raw,tables.lifecycle,{operationId:'MERCHANT_RESPONSE#'+record.dynamodb.NewImage.orderId.S});if(r)rows.push(r);}}
 else if(streamed){const r=await strongGet(raw,tables.lifecycle,{operationId:'MERCHANT_RESPONSE#'+event.orderId});if(r)rows=[r];}
 else {const q=await raw.send(new QueryCommand({TableName:tables.lifecycle,IndexName:'ByDue',KeyConditionExpression:'#q=:q AND #n<=:n',ExpressionAttributeNames:{'#q':'queuePartition','#n':'nextAttemptAt'},ExpressionAttributeValues:{':q':'MERCHANT_RESPONSE',':n':Math.floor(Date.now()/1000)},Limit:25}));rows=q.Items??[];}
 const result={processed:0,review:0,deferred:0};
 for(const row of rows){
  if(!['MERCHANT_RESPONSE','MERCHANT_RESUME'].includes(row.kind)||row.status!=='PENDING'||row.queuePartition!=='MERCHANT_RESPONSE'||row.nextAttemptAt>Math.floor(Date.now()/1000))continue;
  let currentDb:Pick<DynamoDBDocumentClient,'send'>=raw;
  try{
   if(row.kind==='MERCHANT_RESUME'){await resumeMerchantPause(raw,row);result.processed++;continue;}
   const rawOrder=await strongGet(raw,tables.orders,{PK:'ORDER#'+row.orderId,SK:'META'});
   if(rawOrder?.financialSnapshot||rawOrder?.commercialPricing){if(!rollout.containsOrder(row.orderId,rawOrder)){result.deferred++;continue;}currentDb=db;}
   const o=await strongGet(currentDb,tables.orders,{PK:'ORDER#'+row.orderId,SK:'META'});if(!o)throw Object.assign(Error('ORDER_MISSING'),{code:'ORDER_MISSING'});
   const expired=Date.now()>=Date.parse(o.merchantAcceptanceDeadlineAt??'');
   if(!expired&&o.merchantResponsePolicy?.autoAccept!==true)throw Object.assign(Error('WAIT_FOR_RESPONSE'),{code:'WAIT_FOR_RESPONSE'});
   const engine=createMerchantPendingResponse({db:currentDb,enableDeliveryFunding:fundingMode==='REQUIRED',enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',authenticate:async()=>({kind:'SYSTEM',subjectId:'MERCHANT_RESPONSE_WORKER',businessId:row.branchId,ownerId:row.ownerId,guards:[]})});
   await engine.run(row.orderId,expired?'EXPIRE':'AUTO_ACCEPT');result.processed++;
  }catch(error:any){
   const fresh=await strongGet(currentDb,tables.lifecycle,{operationId:row.operationId});if(!fresh||fresh.status!=='PENDING')continue;
   const o=row.orderId?await strongGet(currentDb,tables.orders,{PK:'ORDER#'+row.orderId,SK:'META'}):null,deadline=Date.parse(o?.merchantAcceptanceDeadlineAt??''),attempts=(fresh.responseAttempts??0)+1;
   const deferred=['WAIT_FOR_RESPONSE','MERCHANT_AUTO_ACCEPT_UNAVAILABLE','MERCHANT_RESPONSE_NOT_DUE'].includes(error?.code)&&deadline>Date.now();
   const review=!deferred&&(['MERCHANT_RESPONSE_FINANCIAL_REVIEW_REQUIRED','ORDER_MISSING','MERCHANT_RESPONSE_POLICY_REQUIRED'].includes(error?.code)||attempts>=10);
   const fields=deferred?{nextAttemptAt:Math.ceil(deadline/1000)}:review?{status:'REVIEW_REQUIRED',queuePartition:'MERCHANT_RESPONSE_REVIEW',responseError:String(error?.code??'MERCHANT_RESPONSE_RETRY'),responseAttempts:attempts}: {nextAttemptAt:Math.floor(Date.now()/1000)+60,responseError:String(error?.code??'MERCHANT_RESPONSE_RETRY'),responseAttempts:attempts};
   try{await currentDb.send(new TransactWriteCommand({TransactItems:[set(exactCheck(tables.lifecycle,{operationId:row.operationId},fresh),fields)] as any}));}catch(e:any){if(e.name!=='TransactionCanceledException')throw e;}
   if(deferred)result.deferred++;else if(review)result.review++;
  }
 }
 return result;
}
