import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createMerchantPayoutService} from './merchantPayout';
import {createMerchantSettlementAuthority} from './merchantSettlementAuthority';
import {createMerchantSettlementBatchService} from './merchantSettlementBatch';
import {strongGet,equal,exactCheck} from './driverFinancialTransaction';
const {allowed}=require('../../staff-service/catalog');
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
export function createMerchantPayoutApi(options:{db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
 merchantStaff?:{authorize:(branchId:string,action:string)=>Promise<any>};
 staff?:{employeeId:string;authTime:number;mfaEnrolled:boolean};
 owner?:{subjectId:string;authTime:number;revalidate:()=>Promise<void>};
 readAccount?:(body:Record<string,any>)=>Promise<Record<string,any>>;
 otp?:{secret:()=>Promise<string>;send:(phone:string,code:string)=>Promise<void>}}){
 if([options.staff,options.owner,options.merchantStaff].filter(Boolean).length!==1)return fail('PAYOUT_VERIFIED_PRINCIPAL_REQUIRED');
 const {db}=options,now=options.now??Date.now,staffAuthority=options.staff?createMerchantSettlementAuthority({db,principal:options.staff,now}):null;
 const companyAuthority=options.staff?createMerchantSettlementAuthority({db,principal:options.staff,now,companyCashbook:true}):null;
 const authorize=async(branchId:string,action:'READ'|'OWNER'|'STAFF'|'APPROVE',amount:number)=>{
  if(options.merchantStaff)return options.merchantStaff.authorize(branchId,action);
  if(options.owner){const o=options.owner;await o.revalidate();const age=Math.floor(now()/1000)-o.authTime;if(!Number.isSafeInteger(o.authTime)||age< -30||action!=='READ'&&age>300&&!(process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_SESSION_POLICY==='VALID_SESSION'))return fail('PAYOUT_REAUTH_REQUIRED');if(['STAFF','APPROVE'].includes(action))return fail('PAYOUT_PERMISSION_REQUIRED');const branch=await strongGet(db,'WhizzMerchants_Businesses',{businessId:branchId});if(branch?.ownerId!==o.subjectId||branch?.cognitoUserId!==o.subjectId)return fail('PAYOUT_OWNER_REQUIRED');return {actorId:o.subjectId,owner:true,guards:[exactCheck('WhizzMerchants_Businesses',{businessId:branchId},branch!)]};}
  if(action==='OWNER')return fail('PAYOUT_OWNER_REQUIRED');
  const a=await (branchId==='COMPANY_CASHBOOK'?companyAuthority!:staffAuthority!)(branchId,action==='READ'?'READ':'CREATE');
  if(action==='APPROVE'){
   const e=await strongGet(db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+a.actorId,sk:'PROFILE'});
   if(!e||!allowed(e,'finance.approve')||!Number.isSafeInteger(e.approvalLimit)||e.approvalLimit<amount)return fail('PAYOUT_APPROVAL_LIMIT_OR_PERMISSION_REQUIRED');
   if(!equal(a,await (branchId==='COMPANY_CASHBOOK'?companyAuthority!:staffAuthority!)(branchId,'CREATE')))return fail('PAYOUT_AUTHORIZATION_CHANGED');
  }
  return {actorId:a.actorId,owner:false,guards:a.guards};
 };
 const batches=createMerchantSettlementBatchService({db,now,authorizeBranch:async(branchId,action)=>{if(action!=='READ')return fail('PAYOUT_PERMISSION_REQUIRED');const a=await authorize(branchId,'READ',0);return {branchId,actorId:a.actorId,guards:a.guards};},readSchedule:async()=>null});
 return createMerchantPayoutService({db,now,authorize,...(options.staff?{companyCashAuthority:(action:'READ'|'STAFF'|'APPROVE',amount=0)=>authorize('COMPANY_CASHBOOK',action,amount)}:{}),readAccount:options.readAccount,otp:options.otp,readBatch:(branchId,batchId)=>batches.read({branchId,batchId}),listBatches:(branchId,cursor)=>batches.list({branchId,limit:20,...(cursor?{cursor}:{})})});
}
