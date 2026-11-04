import {auditActor,driverAuditActor} from './financialAudit';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,QueryCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {authenticateFinancialIdentity} from './financialIdentity';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {strongGet,exactCheck,equal} from './driverFinancialTransaction';
import {createDriverCashPayout,verifyDriverCashPaid} from './driverCashPayout';
import {payoutFail as fail} from './driverPayoutEligibility';
const {allowed}=require('../../staff-service/catalog');
type Row=Record<string,any>;
export async function handler(event:Row){try{
 if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||!['driver_cash_payout','staff_driver_cash_payout'].includes(event.action)||typeof event.accessToken!=='string')return fail('UNAUTHORIZED');
 if(process.env.AWS_REGION!=='us-east-1'||(process.env.STAGE??process.env.ENVIRONMENT)!=='staging')return fail('DRIVER_PAYOUT_DISABLED');
 const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'}),driver=event.action==='driver_cash_payout';
 const staff=createExceptionStaffAuthority({db,cognito,accessToken:event.accessToken});
 const authenticate=async()=>driver?authenticateFinancialIdentity(cognito,event.accessToken,'DRIVER'):staff.authenticate();
 const actor=await authenticate();
 if(!event.body||typeof event.body!=='object'||Array.isArray(event.body)||Buffer.byteLength(JSON.stringify(event.body))>16000)return fail('DRIVER_PAYOUT_INVALID_REQUEST');
 if(process.env.DRIVER_CASH_PAYOUT_ENABLED!=='true'){
  if(['READ','CAPABILITIES'].includes(event.body?.action))return {statusCode:200,result:{success:true,enabled:false}};return fail('DRIVER_PAYOUT_DISABLED');
 }
 if(event.body?.action==='CAPABILITIES')return {statusCode:200,result:{success:true,enabled:process.env.DRIVER_CASH_PAYOUT_ENABLED==='true'}};
 if(!driver&&event.body.action==='LIST'){
  if(Object.keys(event.body).some(k=>!['action','cursor'].includes(k)))return fail('DRIVER_PAYOUT_INVALID_REQUEST');
  const access=await staff.readCash(actor as any);let cursor:Row|undefined;
  if(event.body.cursor){try{cursor=JSON.parse(Buffer.from(event.body.cursor,'base64url').toString());if(!cursor||Object.keys(cursor).sort().join(',')!=='pk,sk'||cursor.pk!=='DRIVER_PAYOUT_DIRECTORY#GLOBAL'||typeof cursor.sk!=='string'||!/^REQUEST#.{24}#DPO:[a-f0-9]{48}$/.test(cursor.sk))throw Error();}catch{return fail('DRIVER_PAYOUT_INVALID_CURSOR');}}
  const result=await db.send(new QueryCommand({TableName:'staging-MerchantPlatform',KeyConditionExpression:'pk=:p AND begins_with(sk,:s)',ExpressionAttributeValues:{':p':'DRIVER_PAYOUT_DIRECTORY#GLOBAL',':s':'REQUEST#'},ConsistentRead:true,ScanIndexForward:false,Limit:25,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  for(const r of result.Items||[])if(r.status==='PAID'){const row=await strongGet(db,'staging-MerchantPlatform',{pk:'DRIVER_PAYOUT#'+r.driverId,sk:'PAYOUT#'+r.payoutId});if(!row||row.status!==r.status||row.version!==r.version||!equal(row.amount,r.amount))return fail('DRIVER_PAYOUT_DIRECTORY_CHANGED');await verifyDriverCashPaid(db,row);}
  const fresh=await staff.readCash(await staff.authenticate());if(!equal(access.guard,fresh.guard))return fail('DRIVER_PAYOUT_AUTHORIZATION_CHANGED');
  return {statusCode:200,result:{success:true,enabled:true,items:(result.Items||[]).map(r=>({driverId:r.driverId,payoutId:r.payoutId,recipientName:r.recipientName,amount:r.amount,status:r.status,version:r.version,createdAt:r.createdAt})),nextCursor:result.LastEvaluatedKey?Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64url'):null,coverage:'LOADED_PAGE'}};
 }
 const body={...event.body,...(driver?{driverId:actor.subjectId}:{})};
 if(driver&&event.body?.driverId!==undefined&&event.body.driverId!==actor.subjectId)return fail('UNAUTHORIZED');
 const api=createDriverCashPayout({db,notificationsTable:'staging-WalletNotifications',authorize:async(driverId,role,amount)=>{
  const a=await authenticate();if(driver&&a.subjectId!==driverId||role==='DRIVER'&&!driver||['STAFF','APPROVE'].includes(role)&&driver)return fail('UNAUTHORIZED');
  const p=await strongGet(db,'WhizzDrivers_staging',{driverId});
  if(!p||p.driverId!==driverId||(p.cognitoSub??driverId)!==driverId||p.deletedAt!=null||p.deletionRequestId!=null||p.isDeleted===true)return fail('DRIVER_PAYOUT_DRIVER_UNAVAILABLE');
  const guards:Row[]=[exactCheck('WhizzDrivers_staging',{driverId},p,[...Object.keys(p),'deletedAt','deletionRequestId','isDeleted']),{ConditionCheck:{TableName:'staging-AccountDeletion',Key:{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'},ConditionExpression:'attribute_not_exists(pk)'}}];
  let auditIdentity:Row|undefined=driver?driverAuditActor(a.subjectId,p):undefined;
  if(!driver){const access=role==='APPROVE'?await staff.financial(a as any,amount):role==='STAFF'?await staff.executeCash(a as any):await staff.readCash(a as any);if(role==='STAFF'&&!allowed(access.employee,'finance.request'))return fail('DRIVER_PAYOUT_PERMISSION_REQUIRED');guards.push(access.guard);auditIdentity=auditActor(a.subjectId,access.employee);}
  return {actorId:a.subjectId,driver,driverName:p.name||p.fullName||'السائق',guards,auditIdentity};
 }});
 return {statusCode:200,result:{enabled:true,...await api.handle(body)}};
}catch(e:any){const known=typeof e?.code==='string'&&/^(DRIVER_PAYOUT_|PAYOUT_|EXCEPTION_|UNAUTHORIZED$)/.test(e.code)&&e.code!=='DRIVER_PAYOUT_UNAVAILABLE';return {statusCode:e?.code==='UNAUTHORIZED'?401:known?409:503,code:known?e.code:'DRIVER_PAYOUT_UNAVAILABLE'};}}
