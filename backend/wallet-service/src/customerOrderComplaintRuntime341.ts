import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {CognitoIdentityProviderClient} from '@aws-sdk/client-cognito-identity-provider';
import {authenticateFinancialIdentity} from './financialIdentity';
import {createExceptionStaffAuthority} from './exceptionStaffAuthority';
import {readExceptionCasePolicy,casePhase} from './exceptionCasePolicy';
import {exceptionCaseIndexOperation} from './orderExceptionCaseIndex';
import {exactCheck} from './driverFinancialTransaction';
const {createCustomerOrderComplaints}=require('../../staff-service/customer-order-complaints');
const {benefitGrantKey,BENEFIT_TABLE}=require('../../staff-service/platform-benefits-runtime');
const {voucherState}=require('../../staff-service/customer-benefit-compensation');
type Row=Record<string,any>;
export function createCustomerOrderComplaintRuntime(options:{db:Pick<DynamoDBDocumentClient,'send'>;cognito:Pick<CognitoIdentityProviderClient,'send'>;accessToken:string;action:string;now?:()=>number}){
 const {db}=options,now=options.now??Date.now,authority=createExceptionStaffAuthority(options);
 const authenticate=()=>options.action==='staff_order_complaint'?authority.authenticate():authenticateFinancialIdentity(options.cognito,options.accessToken,'CUSTOMER');
 const get=async(table:string,key:Row)=>(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
 return createCustomerOrderComplaints({db,now,authenticate,
  policy:()=>readExceptionCasePolicy(db),phase:casePhase,index:(input:any)=>exceptionCaseIndexOperation(db,input),
  authorizeStaff:async(actor:any,_order:Row,mode:string,amount:number)=>mode==='FINANCIAL'?authority.financial(actor,amount):mode==='OPERATE'?authority.operate(actor):authority.read(actor),
  verifyVoucher:async(order:Row,row:Row)=>{
   const key={pk:'USER#'+order.userSub,sk:'CASE_COMPENSATION#'+row.caseId},link=await get(BENEFIT_TABLE,key);
   const guards=[link?exactCheck(BENEFIT_TABLE,key,link):{ConditionCheck:{TableName:BENEFIT_TABLE,Key:key,ConditionExpression:'attribute_not_exists(pk)'}}];
   if(!link)return {link:null,valid:false,guards};
   if(link.orderId!==order.orderId||link.caseId!==row.caseId||link.caseKey!=='CUSTOMER_POST_DELIVERY')throw Error('COMPLAINT_REMEDY_REQUIRED');
   const gk=benefitGrantKey(link.campaignId,order.userSub),ck={discountId:link.campaignId},grant=await get(BENEFIT_TABLE,gk),campaign=await get('WizzCentral_Platform_Discounts',ck);
   const valid=grant?.compensationReference?.caseId===row.caseId&&grant?.compensationReference?.orderId===order.orderId&&campaign?.benefit?.amountIqd===link.amountIqd&&['AVAILABLE','RESERVED','USED'].includes(voucherState(campaign,grant,now()));
   if(grant)guards.push(exactCheck(BENEFIT_TABLE,gk,grant));if(campaign)guards.push(exactCheck('WizzCentral_Platform_Discounts',ck,campaign));
   return {link,valid,guards};
  }
 });
}
export async function customerOrderComplaintHandler(event:Row){
 try{
  if((process.env.STAGE??process.env.ENVIRONMENT)!=='staging'||process.env.AWS_REGION!=='us-east-1')throw Error('COMPLAINT_DISABLED');
  if(!event||Object.keys(event).sort().join(',')!=='accessToken,action,body'||!['customer_order_complaint','staff_order_complaint'].includes(event.action)||typeof event.accessToken!=='string')throw Error('INVALID_COMPLAINT');
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}),{marshallOptions:{removeUndefinedValues:true}}),cognito=new CognitoIdentityProviderClient({region:'us-east-1'});
  return {statusCode:200,result:await createCustomerOrderComplaintRuntime({db,cognito,accessToken:event.accessToken,action:event.action}).execute(event.body)};
 }catch(error:any){const code=error?.code??error?.message;return {statusCode:code==='UNAUTHORIZED'?401:code==='EXCEPTION_PERMISSION_REQUIRED'||code==='COMPLAINT_FORBIDDEN'?403:code==='COMPLAINT_UNAVAILABLE'?404:409,code:/^(COMPLAINT_|INVALID_COMPLAINT|EXCEPTION_|UNAUTHORIZED)/.test(code??'')?code:'COMPLAINT_UNAVAILABLE'};}
}
