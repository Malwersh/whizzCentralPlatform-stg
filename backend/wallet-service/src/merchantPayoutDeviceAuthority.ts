import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {exactCheck} from './driverFinancialTransaction';
const devices=require('../merchant-runtime/functions/auth/branch_devices');
import {cashAccountingDeduplicate} from './cashboxAccounting';
type Row=Record<string,any>;
const fail=(code:string,status=403):never=>{throw Object.assign(Error(code),{code,status});};
export const merchantSettlementPermission=(method:string,input:Row)=>{
 if(method==='GET')return input.view==='merchant-account'?'reports.finance.read':['payouts','payout','payout-statements','payout-statement','payout-context'].includes(input.view)?'wallet.settlements.read':fail('PAYOUT_PERMISSION_REQUIRED');
 if(method!=='POST')return fail('PAYOUT_PERMISSION_REQUIRED');
 if(['REQUEST_PAYOUT','CANCEL_PAYOUT'].includes(input.action))return 'finance.payout.request';
 if(['ACK_PAYOUT_RECEIPT','ACK_PAYOUT_NOT_RECEIVED','REPORT_PAYOUT_PROBLEM'].includes(input.action))return 'finance.payout.receive';
 return fail('PAYOUT_OWNER_REQUIRED');
};
export function createMerchantDevicePayoutAuthority(options:{db:Pick<DynamoDBDocumentClient,'send'>;deviceToken:string;staffSession:string;method:string;input:Row;now?:()=>number}){
 const {db}=options,now=options.now||Date.now,required=merchantSettlementPermission(options.method,options.input);
 const runtimeDb:{send:(command:any)=>Promise<any>}={send:(command:any)=>{const q=command.input;if(!q?.Key||!['staging-MerchantPlatform','staging-AccountDeletion','WhizzMerchants_Businesses'].includes(q.TableName))return db.send(command);const fields=q.TableName==='staging-AccountDeletion'?['pk','sk']:q.TableName==='WhizzMerchants_Businesses'?['businessId','ownerId','cognitoUserId','status','deletionRequestId','deletedAt','isDeleted','businessName','name']:['pk','sk','businessId','ownerId','subjectId','membershipId','displayName','role','status','version','permissionSchema','extraPermissions','grant','deviceId','deviceVersion','sessionId','membershipVersion','pinVersion','tokenHash','expiresAt','maxExpiresAt','deletionRequestId','deletedAt','isDeleted'];const names=Object.fromEntries(fields.map((field,n)=>['#p'+n,field]));return db.send(new GetCommand({...q,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names}));}};

 return async(branchId:string,action:string)=>{
  if(!['READ','OWNER'].includes(action))return fail('PAYOUT_PERMISSION_REQUIRED');
  const event={headers:{Authorization:'Bearer '+options.deviceToken,'X-Staff-Session':options.staffSession}},access=await devices.reception(runtimeDb,options.deviceToken),{b,d}=access;
  if(b.businessId!==branchId||options.input.branchId!==branchId)return fail('PAYOUT_BRANCH_SCOPE_REQUIRED');
  const staff=await devices.employeeAccess(runtimeDb,event,access),{s,m,authorization}=staff;
  if(m.permissionSchema!==2||!authorization||s.ownerId!==b.ownerId)return fail('PAYOUT_EXPLICIT_STAFF_GRANT_REQUIRED');
  if(!authorization.permissions.includes(required)||!authorization.permissions.includes('branch.read'))return fail('PAYOUT_PERMISSION_REQUIRED');
  const epoch=Math.floor(now()/1000);if(!Number.isSafeInteger(s.maxExpiresAt)||s.maxExpiresAt<=epoch)return fail('SESSION_REVOKED',401);
  const pin=(await runtimeDb.send(new GetCommand({TableName:'staging-MerchantPlatform',Key:{pk:'BRANCH#'+b.businessId,sk:'PIN#'+s.subjectId},ConsistentRead:true}))).Item;if(!pin||pin.status!=='ACTIVE')return fail('SESSION_REVOKED',401);
  const person=(await db.send(new GetCommand({TableName:'staging-MerchantPlatform',Key:{pk:'PERSON#'+s.subjectId,sk:'PROFILE'},ConsistentRead:true,ProjectionExpression:'pk,sk,subjectId,#name,#version',ExpressionAttributeNames:{'#name':'name','#version':'version'}}))).Item;
  if(!person||person.subjectId!==s.subjectId||typeof person.name!=='string'||!person.name.trim())return fail('PAYOUT_RECIPIENT_PROFILE_REQUIRED');
  const guards=[...devices.guards(b),...staff.common,exactCheck('staging-MerchantPlatform',{pk:pin.pk,sk:pin.sk},pin),exactCheck('staging-MerchantPlatform',{pk:d.pk,sk:d.sk},d),exactCheck('staging-MerchantPlatform',{pk:s.pk,sk:s.sk},s),exactCheck('staging-MerchantPlatform',{pk:m.pk,sk:m.sk},m),exactCheck('staging-MerchantPlatform',{pk:person.pk,sk:person.sk},person)];
  return {actorId:s.subjectId,owner:false,merchantStaff:true,ownerId:b.ownerId,guards:cashAccountingDeduplicate(guards),merchantIdentity:{subjectId:s.subjectId,name:person.name,role:m.grant.roleId,roleLabel:m.grant.roleNameAr,businessId:b.businessId,businessName:b.businessName||b.name,ownerId:b.ownerId,membershipId:m.membershipId,membershipVersion:m.version,policyVersion:authorization.policy.version,roleVersion:m.grant.roleVersion,deviceId:d.deviceId},permissions:authorization.permissions};
 };
}
