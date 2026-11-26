import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { createExceptionStaffAuthority } from './exceptionStaffAuthority';
import { quoteEntityIdValid, quoteHash } from './deliveryQuoteRecord';
import { FinancialRow as Row } from './driverFinancialTransaction';
import { financialDispatchTables } from './walletBindings';

const F = require('../../staff-service/dispatch-followup');
const { createMonitor } = require('../../staff-service/dispatch-followup-monitor');
const { createReviewReader } = require('../../staff-service/dispatch-reviews');
const { allowed } = require('../../staff-service/catalog');

const account='746727375268',region='us-east-1',name='wizz-production-dispatch-followup';
export const ruleArn='arn:aws:events:'+region+':'+account+':rule/'+name;
const functionArn='arn:aws:lambda:'+region+':'+account+':function:'+name;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest=/^[a-f0-9]{64}$/;
const sameKeys=(v:unknown,keys:string)=>v!==null&&typeof v==='object'&&Object.keys(v).sort().join(',')===keys;
const fail=(code:string,status=409):never=>{throw Object.assign(Error(code),{status,code});};
type DB=Pick<DynamoDBDocumentClient,'send'>;
type Authority=ReturnType<typeof createExceptionStaffAuthority>;
type Context={awsRequestId:string;invokedFunctionArn:string;getRemainingTimeInMillis:()=>number};

export function productionOrder(order:Row,branch:Row) {
  const orderId=order.orderId,branchId=branch.businessId,customerSubjectId=order.userSub;
  const pin=order.financeRollout,release='GENERAL_PRODUCTION_FULL_CASH_V1';
  return [orderId,branchId,customerSubjectId,branch.ownerId].every(quoteEntityIdValid) &&
    order.PK==='ORDER#'+orderId && order.SK==='META' && branch.ownerId===branch.cognitoUserId &&
    pin?.schemaVersion===2 && pin?.scopeId===release && pin?.version===1 &&
    pin?.digest===quoteHash({release,version:1,orders:[{orderId,branchId,customerSubjectId}]});
}

function policyView(p:Row,employee:Row){
  return {version:p.version,reviewMinutes:p.values.reviewMinutes,escalationMinutes:p.values.escalationMinutes,
    canSave:allowed(employee,'settings.change.request')};
}

export function createStaffFollowup({db,authority,tables,now=Date.now}:{
  db:DB;authority:Authority;tables:ReturnType<typeof financialDispatchTables>;now?:()=>number;
}) {
  return async (input:Row) => {
    const policyRequest=['READ_POLICY','SAVE_POLICY'].includes(input?.action);
    const permission=policyRequest?'SETTINGS':'FOLLOWUP';
    const profile=policyRequest?authority.settings:authority.followup;
    const actor=await authority.authenticate(permission);
    const access=await profile(actor);
    const employee=access.employee;
    const fresh=async()=>{
      const liveActor=await authority.authenticate(permission);
      const live=await profile(liveActor);
      if(liveActor.subjectId!==actor.subjectId||live.employee.version!==employee.version)
        return fail('EMPLOYEE_CHANGED',403);
      return live.guard;
    };
    const read=(key:Row)=>F.get(db,tables.staff,key);
    const time=()=>new Date(now()).toISOString();
    const employeeById=async(id:string)=>quoteEntityIdValid(id)?read({pk:'EMPLOYEE#'+id,sk:'PROFILE'}):null;
    const audit=(actorId:string,action:string,before:Row|null,after:Row,requestId:string)=>({
      Put:{TableName:tables.staff,Item:{pk:'AUDIT',sk:action+'#'+requestId,kind:'DISPATCH_FOLLOWUP_AUDIT',
        action,actorId,requestId,createdAt:time(),orderId:after.orderId,caseId:after.caseId,
        fromVersion:before?.version??0,toVersion:after.version,note:after.lastNote,reason:after.reason},
        ConditionExpression:'attribute_not_exists(pk)'},
    });

    if(policyRequest){
      const readOnly=input.action==='READ_POLICY';
      if(!sameKeys(input,readOnly?'action':'action,baseVersion,reason,requestId,values'))
        return fail('INVALID_FOLLOWUP_SETTINGS',400);
      if(readOnly) {
        const p=await F.policy(db,tables.staff);
        await fresh();
        return {policy:policyView(p,employee)};
      }
      if(!allowed(employee,'settings.change.request'))return fail('PERMISSION_REQUIRED',403);
      if(!Number.isSafeInteger(input.baseVersion)||input.baseVersion<0||typeof input.requestId!=='string'||
        !uuid.test(input.requestId)||typeof input.reason!=='string'||input.reason.trim().length<5||input.reason.length>300)
        return fail('INVALID_FOLLOWUP_SETTINGS',400);
      const values=F.validate(input.values);
      const currentKey={pk:F.PK,sk:'CURRENT'},versionKey={pk:F.PK,sk:'VERSION#'+input.requestId};
      const requestDigest=quoteHash({input,actorId:actor.subjectId});
      const replay=async()=>{
        const version=await read(versionKey);
        if(!version)return null;
        if(version.requestDigest!==requestDigest)return fail('VERSION_OR_STATE_CONFLICT');
        await fresh();
        return {saved:true,policy:policyView(await F.policy(db,tables.staff),employee)};
      };
      const prior=await replay();
      if(prior)return prior;
      const p=await F.policy(db,tables.staff);
      if(p.version!==input.baseVersion)return fail('VERSION_OR_STATE_CONFLICT');
      const updatedAt=time(),reason=input.reason.trim();
      const next={...currentKey,values,version:p.version+1,policyVersion:input.requestId,updatedAt,updatedBy:actor.subjectId};
      const {Key:_key,...condition}=F.exact(tables.staff,currentKey,p.row).ConditionCheck;
      try{
        await db.send(new TransactWriteCommand({TransactItems:[
          await fresh(),
          {Put:{...condition,Item:next}},
          {Put:{TableName:tables.staff,Item:{...next,...versionKey,requestDigest,reason},ConditionExpression:'attribute_not_exists(pk)'}},
          audit(actor.subjectId,'DISPATCH_FOLLOWUP_SETTINGS_SAVED',p.row,{...next,reason},input.requestId),
        ]}));
      }catch(error:any){
        const saved=await replay();
        if(saved)return saved;
        if(error.name==='TransactionCanceledException')return fail('VERSION_OR_STATE_CONFLICT');
        throw error;
      }
      return {saved:true,policy:policyView(next,employee)};
    }

    const ctx={db,table:tables.staff,orderTables:tables,followupFields:true,includeOrderNumber:true,
      pageLimit:12,ignoreChanged:true,orderPredicate:productionOrder,employee:employeeById,guard:()=>access.guard,audit,now,enrolled:true,
      // Cognito and the employee's minimum authentication time were verified against the current session.
      // Revalidate both immediately before committing the mutation.
      recent:()=>{},freshGuard:fresh};
    const reader=createReviewReader(ctx,employee);
    if(input?.action==='LIST'){
      if(!sameKeys(input,'action,cursor')||
          input.cursor!==null&&(typeof input.cursor!=='string'||!input.cursor||input.cursor.length>2048))
        return fail('INVALID_CURSOR',400);
      const result=await F.alerts({...ctx,query:{cursor:input.cursor}},employee,reader);
      await fresh();
      return result;
    }
    if(!sameKeys(input,'action,baseVersion,caseId,note,orderId,requestId')||
       !['CLAIM','RELEASE','NOTE'].includes(input.action)||!quoteEntityIdValid(input.orderId)||
       typeof input.caseId!=='string'||!digest.test(input.caseId)||typeof input.requestId!=='string'||!uuid.test(input.requestId))
      return fail('INVALID_FOLLOWUP',400);
    const {orderId,caseId,...action}=input;
    const selector={orderId,source:'SEARCH'};
    const result=await F.mutate({...ctx,requireCaseId:caseId},employee,{...action,selector},reader);
    return {saved:result.saved===true};
  };
}

export async function handler(event:Row,context:Context){
  const env=process.env;
  if(env.STAGE!=='production'||env.AWS_REGION!==region||env.FINANCIAL_COD_ACCOUNT_ID!==account||
     env.FINANCE_GENERAL_RELEASE_MODE!=='REQUIRED') return {statusCode:503,code:'FOLLOWUP_UNAVAILABLE'};
  const db=DynamoDBDocumentClient.from(new DynamoDBClient({region,maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
  const tables=financialDispatchTables();
  if(event?.source==='aws.events'){
    if(context?.invokedFunctionArn!==functionArn||event.account!==account||event.region!==region||
       event['detail-type']!=='Scheduled Event'||!Array.isArray(event.resources)||
       event.resources.length!==1||event.resources[0]!==ruleArn) throw Error('FOLLOWUP_MONITOR_TRIGGER_INVALID');
    const result=await createMonitor({db,tables,productionOrder,remainingMs:()=>context.getRemainingTimeInMillis()}).tick(context.awsRequestId);
    console.info('Dispatch follow-up',JSON.stringify(result));
    if(result.failed>0)throw Error('FOLLOWUP_OBSERVATION_FAILED');
    return result;
  }
  if(!sameKeys(event,'accessToken,body')||typeof event.accessToken!=='string'||!event.body)
    return {statusCode:401,code:'UNAUTHORIZED'};
  try{
    const authority=createExceptionStaffAuthority({db,cognito:new CognitoIdentityProviderClient({region,maxAttempts:2}),
      accessToken:event.accessToken});
    return {statusCode:200,result:await createStaffFollowup({db,authority,tables})(event.body)};
  }catch(error:any){
    if(error.code==='UNAUTHORIZED'||['NotAuthorizedException','UserNotFoundException'].includes(error.name))
      return {statusCode:401,code:'UNAUTHORIZED'};
    if(error.status===403||['EXCEPTION_PERMISSION_REQUIRED','EXCEPTION_EMPLOYEE_UNAVAILABLE'].includes(error.code))
      return {statusCode:403,code:'PERMISSION_REQUIRED'};
    if([400,404,409].includes(error.status))return {statusCode:error.status,code:error.code??error.message};
    console.error('Dispatch follow-up request failed',error.name);
    return {statusCode:503,code:'FOLLOWUP_UNAVAILABLE'};
  }
}
