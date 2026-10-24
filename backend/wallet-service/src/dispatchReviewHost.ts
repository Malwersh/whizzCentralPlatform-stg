import {DynamoDBDocumentClient,ScanCommand,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {createStagingDispatchReviewExecutor} from './dispatchReviewExecutor';
import {strongGet,exactCheck,FinancialRow as Row} from './driverFinancialTransaction';
import {setFinancialFields as set} from './financialRelease';
import {quoteHash} from './deliveryQuoteRecord';
const table='staging-PlatformStaff',key={pk:'CONTROL#DISPATCH_REVIEW_HOST',sk:'CURSOR'};
/** Resumable discovery only. The existing executor rechecks live actor/source fences.
 * No public selector, financial writer, cancellation-by-timeout or new scheduler. */
export function createStagingDispatchReviewHost(options:{db:Pick<DynamoDBDocumentClient,'send'>;cognito:Pick<CognitoIdentityProviderClient,'send'>;now?:()=>number;mode?:string;remainingMs?:()=>number;enableFullCash?:boolean}){
 const {db}=options,now=options.now??Date.now,mode=options.mode??process.env.DISPATCH_REVIEW_EXECUTION_MODE;
 return {async tick(owner:string){
  if(!['SAFE_INITIAL_LEGACY','SAFE_LEGACY_RETRY','SAFE_FINANCIAL_INITIAL_RETRY'].includes(mode??''))throw Error('DISPATCH_REVIEW_EXECUTION_DISABLED');
  if(!/^[A-Za-z0-9:_-]{1,120}$/.test(owner))throw Error('DISPATCH_REVIEW_HOST_OWNER_INVALID');
  const time=now(),previous=await strongGet(db,table,key);if(!Number.isSafeInteger(time))throw Error('DISPATCH_REVIEW_HOST_TIME_INVALID');
  if(previous&&(previous.kind!=='DISPATCH_REVIEW_HOST_CURSOR'||!Number.isSafeInteger(previous.version)||previous.version<1||!Number.isSafeInteger(previous.leaseUntil)))throw Error('DISPATCH_REVIEW_HOST_CURSOR_INVALID');
  if(previous?.leaseUntil>time)return {busy:true};
  const claimed={...key,kind:'DISPATCH_REVIEW_HOST_CURSOR',version:(previous?.version??0)+1,cursor:previous?.cursor??null,leaseOwner:owner,leaseUntil:time+90000,updatedAt:new Date(time).toISOString()};
  const {TableName,Key,...condition}=previous?exactCheck(table,key,previous).ConditionCheck:{ConditionExpression:'attribute_not_exists(pk)'} as Row;void TableName;void Key;
  try{await db.send(new TransactWriteCommand({TransactItems:[{Put:{TableName:table,Item:claimed,...condition}}],ClientRequestToken:quoteHash(claimed).slice(0,36)}));}catch(error){const saved=await strongGet(db,table,key);if(saved?.version!==claimed.version||saved?.leaseOwner!==owner)return {busy:true};throw error;}
  const executor=createStagingDispatchReviewExecutor({...options,mode});let processed=0,failed=0,complete=true,next=claimed.cursor;
  const page=await db.send(new ScanCommand({TableName:table,ConsistentRead:true,Select:'SPECIFIC_ATTRIBUTES',Limit:mode==='SAFE_FINANCIAL_INITIAL_RETRY'?250:25,ExclusiveStartKey:claimed.cursor??undefined,ProjectionExpression:'pk,sk',FilterExpression:'begins_with(pk,:prefix) AND sk=:decision AND #kind=:kind AND (#status=:pending OR #status=:blocked)',ExpressionAttributeNames:{'#kind':'kind','#status':'status'},ExpressionAttributeValues:{':prefix':'DISPATCH_REVIEW#',':decision':'DECISION',':kind':'DISPATCH_REVIEW_DECISION',':pending':'PENDING_EXECUTION',':blocked':'BLOCKED_DEPENDENCY'}}));
  for(const row of page.Items??[]){
   if((options.remainingMs?.()??60000)<20000||now()>=claimed.leaseUntil){complete=false;break;}
   if(!/^DISPATCH_REVIEW#[a-f0-9]{64}$/.test(row.pk??'')||row.sk!=='DECISION')throw Error('DISPATCH_REVIEW_HOST_ROW_INVALID');
   try{await executor.process(row.pk.slice('DISPATCH_REVIEW#'.length));processed++;}catch{failed++;}
   next={pk:row.pk,sk:row.sk};
  }
  if(complete)next=page.LastEvaluatedKey??null;
  await db.send(new TransactWriteCommand({TransactItems:[set(exactCheck(table,key,claimed),{cursor:next,leaseUntil:0,processed,failed,updatedAt:new Date(now()).toISOString()})] as any}));
  return {processed,failed,complete,hasContinuation:next!==null};
 }};
}
