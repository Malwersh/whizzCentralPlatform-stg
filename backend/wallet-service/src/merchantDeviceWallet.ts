import {randomUUID} from 'crypto';
import {APIGatewayProxyEvent} from 'aws-lambda';
import {docClient,TABLES,GetCommand,QueryCommand,TransactWriteCommand} from './db';
import {fundingError} from './fundingService';
import {buildSuccessResponse,buildErrorResponse} from './utils';
import {WalletError} from './types';
import {merchantSalesReport,exportSalesReport} from './merchantSalesReport';
import {statementPeriod,walletStatement} from './walletStatement';
const devices=require('../merchant-runtime/functions/auth/branch_devices');
const platform='staging-MerchantPlatform',businesses='WhizzMerchants_Businesses',deletions='staging-AccountDeletion';
// In particular, PIN salt/digest are never read by the financial service.
export const runtimeAttributes=['pk','sk','businessId','ownerId','cognitoUserId','subjectId','membershipId','displayName','role','status','version','permissionSchema','extraPermissions','grant','deviceId','deviceVersion','sessionId','membershipVersion','pinVersion','tokenHash','expiresAt','deletionRequestId'];
export const runtimeDb={send:(command:any)=>{
 if(command instanceof GetCommand&&[platform,businesses,deletions].includes(command.input.TableName||'')){
  const fields=command.input.TableName===deletions?['pk','sk']:command.input.TableName===businesses?['businessId','ownerId','cognitoUserId','status','deletionRequestId']:runtimeAttributes;
  const names=Object.fromEntries(fields.map((field,i)=>['#field'+i,field]));
  return docClient.send(new GetCommand({...command.input,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}));
 }
 return docClient.send(command);
}};
function fail(code:string,status=403):never{throw fundingError('لا يمكن قراءة هذه المحفظة من جلسة الموظف الحالية',code,status);}
const pick=(row:any,fields:string[])=>Object.fromEntries(fields.filter(field=>row[field]!==undefined).map(field=>[field,row[field]]));
export async function readMerchantDeviceWallet(event:APIGatewayProxyEvent){
 try{
  if(process.env.ENVIRONMENT!=='staging')fail('NOT_FOUND',404);
  const kind=event.path==='/wallet/branch-device/balance'?'balance':event.path==='/wallet/branch-device/transactions'?'transactions':event.path==='/wallet/branch-device/statement'?'statement':event.path==='/wallet/branch-device/sales-report'?'sales':null;
  if(!kind||event.httpMethod!=='GET')fail('PERMISSION_REQUIRED');
  const query=event.queryStringParameters||{};
  if(Object.keys(query).some(key=>!(['sales','statement'].includes(kind)?['businessId','from','to','format']:['businessId','cursor']).includes(key))||kind==='balance'&&query.cursor||['sales','statement'].includes(kind)&&query.format!==undefined&&!['json','csv'].includes(query.format))fail('INVALID_QUERY',400);
  const token=/^Bearer (\S+)$/.exec(event.headers?.Authorization||event.headers?.authorization||'')?.[1];
  if(!token)fail('DEVICE_REVOKED',401);
  const access=await devices.reception(runtimeDb,token),{b,d}=access;
  if(query.businessId!==b.businessId)fail('BRANCH_SCOPE_REQUIRED');
  const staff=await devices.employeeAccess(runtimeDb,event,access);
  const permission=kind==='sales'?'reports.sales.read':kind==='balance'?'wallet.balance.read':'wallet.transactions.read';
  if(!staff.authorization?.permissions.includes(permission))fail('PERMISSION_REQUIRED');
  if(kind==='statement'&&query.format==='csv'&&!staff.authorization.permissions.includes('wallet.export'))fail('PERMISSION_REQUIRED');
  if(kind==='sales'&&query.format==='csv'&&!staff.authorization.permissions.includes('reports.export'))fail('PERMISSION_REQUIRED');
  const period=['statement','sales'].includes(kind)?statementPeriod(query.from,query.to):undefined;
  const guards=[...devices.guards(b),devices.check(d),...staff.common];
  await devices.tx(runtimeDb,guards);
  const walletId='WALLET#MERCHANT#'+b.businessId;
  let cursor:any;
  if(query.cursor){try{if(query.cursor.length>2048)throw Error();cursor=JSON.parse(Buffer.from(query.cursor,'base64url').toString());if(Object.keys(cursor).sort().join(',')!=='sk,walletId'||cursor.walletId!==walletId||typeof cursor.sk!=='string'||!cursor.sk.startsWith('ts#'))throw Error();}catch{fail('INVALID_CURSOR',400);}}
  const wallet=kind==='sales'?null:(await docClient.send(new GetCommand({TableName:TABLES.WALLETS,Key:{walletId,sk:'META'},ConsistentRead:true,ProjectionExpression:'walletId,sk,ownerType,ownerId,currency,#status,availableBalance,lockedBalance,updatedAt,deletionRequestId',ExpressionAttributeNames:{'#status':'status'}}))).Item;
  if(kind!=='sales'&&(!wallet||wallet.walletId!==walletId||wallet.ownerType!=='MERCHANT'||wallet.ownerId!==b.businessId||wallet.currency!=='IQD'||wallet.deletionRequestId||!['ACTIVE','SUSPENDED'].includes(wallet.status)))fail('WALLET_UNAVAILABLE',409);
  let result:any;
  if(kind==='sales'){
   result=await merchantSalesReport(b.businessId,period!);
   if(query.format==='csv')result=exportSalesReport(result);
  }else if(kind==='statement'){
   result=await walletStatement(walletId,period!,query.format==='csv');
  }else if(kind==='balance'){
   if(!wallet)fail('WALLET_UNAVAILABLE',409);
   if(!Number.isSafeInteger(wallet.availableBalance)||!Number.isSafeInteger(wallet.lockedBalance))fail('WALLET_UNAVAILABLE',409);
   result=pick(wallet,['walletId','currency','status','availableBalance','lockedBalance','updatedAt']);
  }else{
   const fields=['sk','transactionId','txnId','type','category','amount','balance','balanceBefore','balanceAfter','relatedEntityId','relatedEntityType','description','createdAt','timestamp'];
   const names=Object.fromEntries(['walletId',...fields].map((field,i)=>['#ledger'+i,field]));
   const page=await docClient.send(new QueryCommand({TableName:TABLES.LEDGER,KeyConditionExpression:'walletId=:wallet AND begins_with(sk,:prefix)',ExpressionAttributeValues:{':wallet':walletId,':prefix':'ts#'},ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names,ConsistentRead:true,ScanIndexForward:false,Limit:30,...(cursor?{ExclusiveStartKey:cursor}:{})}));
   result={walletId,currency:'IQD',transactions:(page.Items||[]).filter(row=>row.walletId===walletId).map(row=>pick(row,fields)),nextCursor:page.LastEvaluatedKey?Buffer.from(JSON.stringify({walletId,sk:page.LastEvaluatedKey.sk})).toString('base64url'):null};
  }
  const time=new Date().toISOString(),auditId=randomUUID();
  const action=kind==='sales'?(query.format==='csv'?'MERCHANT_STAFF_SALES_REPORT_EXPORT':'MERCHANT_STAFF_SALES_REPORT_READ'):kind==='statement'?(query.format==='csv'?'MERCHANT_STAFF_STATEMENT_EXPORT':'MERCHANT_STAFF_STATEMENT_READ'):kind==='balance'?'MERCHANT_STAFF_BALANCE_READ':'MERCHANT_STAFF_TRANSACTIONS_READ';
  const activity={pk:'BRANCH#'+b.businessId,sk:'STAFF_AUDIT#OPERATIONS#'+time+'#'+auditId,ownerId:b.ownerId,businessId:b.businessId,actorId:staff.s.subjectId,actorName:staff.m.displayName||'',roleName:staff.m.grant?.roleNameAr||staff.m.role||'',deviceId:d.deviceId,sessionId:staff.s.sessionId,permissionVersion:staff.m.version,policyVersion:staff.authorization.policy.version,action,entityId:b.businessId,result:'SUCCEEDED',createdAt:time,...(period?{periodFrom:period.from,periodTo:period.to}:{}),format:query.format==='csv'?'csv':'json'};
  // Sensitive reads are released only after their access proof and audit commit.
  await docClient.send(new TransactWriteCommand({TransactItems:[...guards,{Put:{TableName:TABLES.AUDIT_LOG,Item:{datePartition:'date#'+time.slice(0,10).replace(/-/g,''),sk:time+'#'+auditId,action,...(kind==='sales'?{periodFrom:period!.from,periodTo:period!.to,reportRuleVersion:result.summary.ruleVersion,reportSummaryStatus:result.summary.status}:period?{periodFrom:period.from,periodTo:period.to,rowCount:result.rowCount,effectRuleVersion:result.effectSummary.ruleVersion,effectSummaryStatus:result.effectSummary.status}:{}),actorId:staff.s.subjectId,businessId:b.businessId,walletId,deviceId:d.deviceId,sessionId:staff.s.sessionId,membershipVersion:staff.m.version,policyVersion:staff.authorization.policy.version,createdAt:time,result:'SUCCEEDED'},ConditionExpression:'attribute_not_exists(datePartition)'}},{Put:{TableName:platform,Item:activity,ConditionExpression:'attribute_not_exists(pk)'}}]}));
  return {...result,asOf:time};
 }catch(error:any){if(error.name==='TransactionCanceledException')fail('VERSION_OR_STATE_CONFLICT',409);if(error.status)fail(error.message,error.status);throw error;}
}

export async function handler(event:any){
 if(event.type==='TOKEN'){
  if(process.env.ENVIRONMENT!=='staging')throw Error('Unauthorized');
  return devices.authorizer(runtimeDb,event);
 }
 try{return buildSuccessResponse(await readMerchantDeviceWallet(event));}
 catch(error:any){if(error instanceof WalletError)return buildErrorResponse(error.statusCode,error.code,error.message);return buildErrorResponse(503,'FINANCIAL_READ_UNAVAILABLE','تعذر تحميل بيانات المحفظة. أعد المحاولة.');}
}
