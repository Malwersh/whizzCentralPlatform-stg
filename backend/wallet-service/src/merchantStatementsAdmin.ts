import {merchantOffCyclePeriod} from './merchantOffCyclePeriod';
import {readMerchantStatementPayment} from './merchantPayout';
import {createMerchantStatementApproval,readMerchantStatementApproval} from './merchantStatementApproval';
import {strongGet} from './driverFinancialTransaction';
const {allowed}=require('../../staff-service/catalog');
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {createMerchantSettlementAuthority} from './merchantSettlementAuthority';
import {createMerchantSettlementBatchService} from './merchantSettlementBatch';
import {createMerchantSettlementScheduleHistoryReader} from './merchantSettlementScheduleHistory';
import {createMerchantOpeningScheduleReader} from './merchantOpeningScheduleReader';
import {merchantOpeningPeriod} from './merchantOpeningPeriod';
import {merchantSettlementPeriod} from './merchantSettlementPeriod';
import {assembleMerchantSettlementPreview,readMerchantAccrualEvidence} from './merchantSettlementPreview';
import {equal} from './driverFinancialTransaction';
import {quoteEntityIdValid} from './deliveryQuoteRecord';
type Row=Record<string,any>;
const fail=(code='INVALID_SETTLEMENT_BATCH_REQUEST'):never=>{throw Object.assign(Error(code),{code});};
/** Staff-only adapter. Principal must be the verified HTTP identity, never body JSON. */
export function createMerchantStatementsAdmin(options:{db:Pick<DynamoDBDocumentClient,'send'>;principal:{employeeId:string;authTime:number;mfaEnrolled:boolean};now?:()=>number}){
 const {db}=options,now=options.now??Date.now,authorize=createMerchantSettlementAuthority(options),readSchedule=createMerchantSettlementScheduleHistoryReader(db),readOpeningSchedule=createMerchantOpeningScheduleReader(db);
 const batches=createMerchantSettlementBatchService({db,authorizeBranch:authorize,readSchedule,readOpeningSchedule,now});
 const approve=createMerchantStatementApproval({db,now,readBatch:batches.read,authorize:async branchId=>{
  const before=await authorize(branchId,'CREATE'),employee=await strongGet(db,'staging-PlatformStaff',{pk:'EMPLOYEE#'+options.principal.employeeId,sk:'PROFILE'});
  if(!employee||!allowed(employee,'finance.approve'))return fail('SETTLEMENT_PERMISSION_REQUIRED');
  if(!equal(before,await authorize(branchId,'CREATE')))return fail('SETTLEMENT_AUTHORIZATION_CHANGED');return before;
 }});
 return {
  approve,create:(body:unknown)=>batches.create(body),
  async list(body:unknown){const result=await batches.list(body);const items=[];for(const item of result.items){const approval=await readMerchantStatementApproval(db,item.branchId,item.batchId,item.batchDigest);let claim=await strongGet(db,'staging-MerchantPlatform',{pk:'MERCHANT_PAYOUT#'+item.branchId,sk:'BATCH#'+item.batchId});if(claim?.status==='PAID'){const branch=await strongGet(db,'WhizzMerchants_Businesses',{businessId:item.branchId});claim=await readMerchantStatementPayment(db,await batches.read({branchId:item.branchId,batchId:item.batchId}),branch?.ownerId);}items.push({...item,approvalStatus:approval?.status??'PENDING_REVIEW',paymentStatus:claim?.status==='PAID'?'PAID':'UNPAID',payoutId:claim?.payoutId||null});}await authorize((body as Row).branchId,'READ');return {...result,items};},
  async read(body:unknown){const result=await batches.read(body);const approval=await readMerchantStatementApproval(db,result.header.branchId,result.header.batchId,result.header.batchDigest);await authorize(result.header.branchId,'READ');return {...result,approval};},
  async preview(body:unknown){
   if(!body||typeof body!=='object'||Array.isArray(body))return fail();const v=body as Row,opening=v.kind==='OPENING',offCycle=v.kind==='OFF_CYCLE',cutoff=new Date(now()).toISOString();
   if(Object.keys(v).sort().join(',')!==(offCycle?'branchId,kind,orderIds,reason':opening?'branchId,fromLocalDate,kind,orderIds':'at,branchId,orderIds')||!quoteEntityIdValid(v.branchId)||!Array.isArray(v.orderIds)||!v.orderIds.length||v.orderIds.length>10||v.orderIds.some((id:unknown)=>!quoteEntityIdValid(id))||new Set(v.orderIds).size!==v.orderIds.length)return fail();
   const actor=await authorize(v.branchId,'READ'),source=await (opening?readOpeningSchedule(v.branchId):readSchedule(v.branchId,offCycle?cutoff:v.at));
   if(!source)return fail('SETTLEMENT_SCHEDULE_APPROVAL_REQUIRED');
   let period=opening?merchantOpeningPeriod(source.schedule,v.fromLocalDate,(source as Row).openingCutoff):merchantSettlementPeriod(source.schedule,offCycle?cutoff:v.at);
   const accruals=[];
   for(const id of v.orderIds){const proof=await readMerchantAccrualEvidence(db,v.branchId,id);
    if(['settlementBatchId','settlementLineDigest','settlementClaimedAt'].some(k=>Object.prototype.hasOwnProperty.call(proof.payable,k)))return fail('MERCHANT_PAYABLE_ALREADY_IN_SETTLEMENT');
    if(!opening&&'agreementBinding' in source&&source.agreementBinding&&!equal(proof.accrual.agreement,source.agreementBinding))return fail('SETTLEMENT_AGREEMENT_SCHEDULE_MISMATCH');
    accruals.push(proof.accrual);
   }
   if(offCycle){const earliest=accruals.map(a=>a.deliveredAt).sort()[0],local=(at:string)=>new Date(Date.parse(at)+10800000).toISOString().slice(0,10);period=merchantOffCyclePeriod(source.schedule,local(earliest),local(cutoff),cutoff,v.reason) as any;}
   const preview=assembleMerchantSettlementPreview(v.branchId,period,accruals);
   if((await authorize(v.branchId,'READ')).actorId!==actor.actorId)return fail('SETTLEMENT_AUTHORIZATION_CHANGED');
   return {...preview,periodClosed:new Date(now()).toISOString()>=period.untilExclusiveUtc,request:{branchId:v.branchId,at:offCycle?cutoff:opening?period.untilExclusiveUtc:v.at,orderIds:[...v.orderIds].sort(),previewId:preview.previewId,...(offCycle?{kind:'OFF_CYCLE',fromLocalDate:period.startLocalDate,throughLocalDate:(period as any).throughLocalDate,reason:v.reason.trim()}:opening?{kind:'OPENING',fromLocalDate:v.fromLocalDate}:{})}};
  }
 };
}
