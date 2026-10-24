import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {authenticateFinancialIdentity} from './financialIdentity';
import {exactCheck,strongGet} from './driverFinancialTransaction';
import {ReturnActor} from './codFlowContext';
const {allowed}=require('../../staff-service/catalog');
type Row=Record<string,any>;
const fail=(code='EXCEPTION_PERMISSION_REQUIRED'):never=>{throw Object.assign(Error(code),{code});};
/** Validates original access token against Cognito, then current global employee authority.
 * Caller-provided actor, role, approvedBy and limits are never accepted. */
export function createExceptionStaffAuthority(options:{db:Pick<DynamoDBDocumentClient,'send'>;cognito:Pick<CognitoIdentityProviderClient,'send'>;accessToken:string;now?:()=>number}){
 const now=options.now??Date.now;
 async function profile(subjectId:string,permission:'READ'|'OPERATE'|'FINANCIAL'){
  const key={pk:'EMPLOYEE#'+subjectId,sk:'PROFILE'},employee=await strongGet(options.db,'staging-PlatformStaff',key);
  let claims:Row;try{claims=JSON.parse(Buffer.from(options.accessToken.split('.')[1],'base64url').toString());}catch{return fail('UNAUTHORIZED');}
  if(!employee||employee.employeeId!==subjectId||employee.status!=='ACTIVE'||!Number.isSafeInteger(employee.version)||employee.version<1||employee.scope?.allRegions!==true||employee.deletedAt!=null||employee.deletionRequestId!=null||employee.isDeleted===true||!Number.isSafeInteger(claims.auth_time)||claims.auth_time>Math.floor(now()/1000)+30||(employee.minimumAuthTime??0)>claims.auth_time)return fail('EXCEPTION_EMPLOYEE_UNAVAILABLE');
  if(permission==='READ'?!allowed(employee,'orders.read')&&!allowed(employee,'finance.read'):permission==='OPERATE'?!allowed(employee,'orders.cancel')&&!allowed(employee,'finance.approve'):!allowed(employee,'finance.approve'))return fail();
  if(permission==='FINANCIAL'&&(!Number.isSafeInteger(employee.approvalLimit)||employee.approvalLimit<0))return fail();
  return {employee,guard:exactCheck('staging-PlatformStaff',key,employee,[...Object.keys(employee),'roles','scope','minimumAuthTime','approvalLimit','mfaRequired','deletedAt','deletionRequestId','isDeleted'])};
 }
 return {
  async authenticate():Promise<{kind:'STAFF';subjectId:string}>{const actor=await authenticateFinancialIdentity(options.cognito,options.accessToken,'STAFF');await profile(actor.subjectId,'READ');return actor;},
  async authorizeStaff(actor:ReturnActor,_order:Row,_branch:Row){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const p=await profile(actor.subjectId,'OPERATE');return [p.guard];},
  async cancel(actor:ReturnActor){const p=await profile(actor.subjectId,'READ');if(actor.kind!=='STAFF'||!allowed(p.employee,'orders.cancel'))return fail();return [p.guard];},
  async assign(actor:ReturnActor){const p=await profile(actor.subjectId,'READ');if(actor.kind!=='STAFF'||!allowed(p.employee,'orders.assign'))return fail();return [p.guard];},
  async read(actor:ReturnActor){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');return profile(actor.subjectId,'READ');},
  async readCash(actor:ReturnActor){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const p=await profile(actor.subjectId,'READ');if(!allowed(p.employee,'finance.read'))return fail();return p;},
  async operate(actor:ReturnActor){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');return profile(actor.subjectId,'OPERATE');},
  async financial(actor:ReturnActor,amount:number){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const p=await profile(actor.subjectId,'FINANCIAL');if(!Number.isSafeInteger(amount)||amount<0||amount>p.employee.approvalLimit)return fail('EXCEPTION_APPROVAL_LIMIT');return p;},
  async executeCash(actor:ReturnActor){if(actor.kind!=='STAFF')return fail('UNAUTHORIZED');const p=await profile(actor.subjectId,'READ');if(!allowed(p.employee,'finance.request'))return fail();return p;}
 };
}
