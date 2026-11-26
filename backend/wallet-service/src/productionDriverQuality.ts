import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateFinancialIdentity } from './financialIdentity';
import { createDriverQualityAppeal } from './driverQualityAppeal';
import { createDriverQualityReview, DRIVER_QUALITY_ACTIONS } from './driverQualityReview';
import { createDriverTimingReview, DRIVER_TIMING_ACTIONS } from './driverTimingReview';
import { createDriverRatingReview, DRIVER_RATING_ACTIONS } from './driverRatingReview';
import { exactCheck, strongGet, FinancialRow as Row } from './driverFinancialTransaction';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
import { financialDispatchTables } from './walletBindings';

const { allowed } = require('../../staff-service/catalog');
const { readIncidents } = require('../../shared/production-driver-quality-incidents');
type DB = Pick<DynamoDBDocumentClient, 'send'>;
type Authenticate = (token: string, kind: 'STAFF' | 'DRIVER') => Promise<{kind: 'STAFF' | 'DRIVER'; subjectId: string}>;
const staffRoute = '/staff/drivers/{driverId}/quality';
const readRoute = '/driver/quality-incidents';
const appealRoute = '/driver/quality-incidents/appeal';
const evidenceOrderNumber = /^ORD[0-9]{8,30}$/i;
const publicFailure = (code:string, status:number):never => {
  throw Object.assign(Error(code), { code, status });
};
const reply = (statusCode:number, data:Row) => ({
  statusCode, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
  body:JSON.stringify(data),
});
const available = (driver:Row|null, driverId:string) =>
  driver?.driverId === driverId && !driver.isDeleted && !driver.deletedAt && !driver.deletionRequestId;

export function createProductionDriverQuality(db:DB, authenticate:Authenticate, now=Date.now) {
  const tables = financialDispatchTables();

  async function driverProfile(driverId:string){
    const [driver,closure] = await Promise.all([
      strongGet(db,tables.driver,{driverId}),
      strongGet(db,tables.deletion,{pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'}),
    ]);
    if (!available(driver,driverId) || closure) return publicFailure('DRIVER_UNAVAILABLE',404);
    return driver!;
  }
  async function list(driverId:string){
    const result = await readIncidents({
      db, GetCommand, QueryCommand, driverId,
      tables:{drivers:tables.driver,offers:tables.offers,holds:tables.holds,orders:tables.orders},
    });
    await driverProfile(driverId);
    return result;
  }
  async function resolveOrderId(reference:unknown){
    if (!quoteEntityIdValid(reference)) return publicFailure('INVALID_DRIVER_QUALITY_REVIEW',400);
    const value=String(reference);
    if (!evidenceOrderNumber.test(value)) return value;
    const result = await db.send(new QueryCommand({
      TableName:tables.orders, IndexName:'GSI_OrderNumber',
      KeyConditionExpression:'orderNumber = :number', ExpressionAttributeValues:{':number':value},
      ProjectionExpression:'PK, SK, orderId', Limit:2,
    }));
    const rows=result.Items??[];
    if (result.LastEvaluatedKey || rows.length!==1 || rows[0].SK!=='META' ||
        !quoteEntityIdValid(rows[0].orderId) || rows[0].PK!=='ORDER#'+rows[0].orderId){
      return publicFailure('DRIVER_QUALITY_ATTEMPT_UNAVAILABLE',404);
    }
    return rows[0].orderId;
  }

  return async (event:Row) => {
    const path=event.resource, method=event.httpMethod;
    const isStaff=path===staffRoute;
    if (event.requestContext?.stage!=='production' ||
        !(isStaff ? method==='GET'||method==='POST' : path===readRoute&&method==='GET' || path===appealRoute&&method==='POST')){
      return reply(404,{success:false,code:'NOT_FOUND'});
    }
    try {
      const headers=Object.entries(event.headers??{}).filter(([name])=>name.toLowerCase()==='authorization');
      const multi=Object.entries(event.multiValueHeaders??{}).filter(([name])=>name.toLowerCase()==='authorization');
      const raw=headers[0]?.[1];
      const token=headers.length===1 && (multi.length===0 ||
        multi.length===1 && Array.isArray(multi[0][1]) && multi[0][1].length===1 && multi[0][1][0]===raw) &&
        typeof raw==='string' && raw.length<=16000 ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(raw)?.[1] : undefined;
      if (!token) return publicFailure('UNAUTHORIZED',401);
      const authKind=isStaff?'STAFF':'DRIVER';
      const auth=async()=>{
        const actor=await authenticate(token,authKind);
        if(actor.kind!==authKind || !quoteEntityIdValid(actor.subjectId)) return publicFailure('UNAUTHORIZED',401);
        return actor;
      };
      const actor=await auth();
      const driverId=isStaff?event.pathParameters?.driverId:actor.subjectId;
      if (!quoteEntityIdValid(driverId)) return publicFailure('DRIVER_UNAVAILABLE',404);

      let body:Row|undefined;
      if (method==='POST'){
        try {
          if (event.isBase64Encoded || typeof event.body!=='string' || Buffer.byteLength(event.body)>12000) throw Error();
          body=JSON.parse(event.body);
          if (!body || typeof body!=='object' || Array.isArray(body)) throw Error();
        } catch { return publicFailure('INVALID_DRIVER_QUALITY_REVIEW',400); }
      }

      if (!isStaff){
        await driverProfile(driverId);
        if (method==='GET') return reply(200,await list(driverId));
        const appeal=createDriverQualityAppeal({db,authenticate:auth,now});
        return reply(200,await appeal(body!));
      }

      const staffKey={pk:'EMPLOYEE#'+actor.subjectId,sk:'PROFILE'};
      const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
      async function authorize(write=false){
        const [employee,driver]=await Promise.all([strongGet(db,tables.staff,staffKey),driverProfile(driverId)]);
        const permission=write?'drivers.review':'drivers.read';
        const scope=employee?.scope?.allRegions===true ||
          typeof driver.work_region_id==='string' && allowed(employee,permission,driver.work_region_id);
        if(!employee || employee.employeeId!==actor.subjectId || employee.status!=='ACTIVE' ||
           employee.isDeleted || employee.deletedAt || employee.deletionRequestId ||
           !Number.isSafeInteger(employee.version) || employee.version<1 ||
           !Number.isSafeInteger(claims.auth_time) || claims.auth_time>Math.floor(now()/1000)+30 ||
           (employee.minimumAuthTime??0)>claims.auth_time || !scope || !allowed(employee,permission)){
          return publicFailure('PERMISSION_REQUIRED',403);
        }
        const guard=exactCheck(tables.staff,staffKey,employee,[
          'employeeId','version','status','roles','scope','minimumAuthTime','mfaRequired','deletedAt','deletionRequestId','isDeleted',
        ]);
        return {employee,driver,guard};
      }
      function capabilities(employee:Row,driver:Row){
        return {review: allowed(employee,'drivers.review') && (employee.scope?.allRegions===true ||
          typeof driver.work_region_id==='string' && allowed(employee,'drivers.review',driver.work_region_id))};
      }
      const access=await authorize();
      if (method==='GET'){
        const result=await list(driverId);
        const latest=await authorize();
        return reply(200,{...result,capabilities:capabilities(latest.employee,latest.driver)});
      }
      const action=body!.action;
      const timing=DRIVER_TIMING_ACTIONS.includes(action);
      const rating=DRIVER_RATING_ACTIONS.includes(action);
      if (!timing&&!rating&&!DRIVER_QUALITY_ACTIONS.includes(action)) {
        return publicFailure('INVALID_DRIVER_QUALITY_REVIEW',400);
      }
      const staffActor=async()=>{
        const verified=await auth();
        if(verified.subjectId!==actor.subjectId) return publicFailure('UNAUTHORIZED',401);
        return {kind:'STAFF' as const,subjectId:verified.subjectId};
      };
      const options={
        db,now,expectedDriverId:driverId,
        driverGuard: exactCheck(tables.driver,{driverId},access.driver,[
          'driverId','work_region_id','isDeleted','deletedAt','deletionRequestId',
        ]),
        authority:{
          authenticate:staffActor,
          read:async()=>authorize(),
          operate:async()=>authorize(true),
        },
      };
      const review=timing?createDriverTimingReview(options):rating
        ?createDriverRatingReview({...options,expectedRegion:{id:access.driver.work_region_id}})
        :createDriverQualityReview(options);
      const orderId=await resolveOrderId(body!.orderId);
      const result=await review({...body,orderId});
      if (action.startsWith('READ_')){
        const latest=await authorize();
        return reply(200,{...result,capabilities:capabilities(latest.employee,latest.driver)});
      }
      return reply(200,result);
    } catch(error:any){
      if (error.status) return reply(error.status,{success:false,code:error.code});
      if (error.code==='UNAUTHORIZED'||['NotAuthorizedException','UserNotFoundException'].includes(error.name)){
        return reply(401,{success:false,code:'UNAUTHORIZED'});
      }
      const code=error.code||error.message;
      if (typeof code==='string'&&/^INVALID_DRIVER_(QUALITY|TIMING|RATING)_REVIEW$/.test(code)) {
        return reply(400,{success:false,code});
      }
      if (['DRIVER_QUALITY_ATTEMPT_UNAVAILABLE','DRIVER_QUALITY_CASE_UNAVAILABLE','HISTORICAL_FINANCIAL_OFFER_UNAVAILABLE'].includes(code)){
        return reply(404,{success:false,code:'DRIVER_QUALITY_ATTEMPT_UNAVAILABLE'});
      }
      if (['DRIVER_TIMING_ATTEMPT_UNAVAILABLE','DRIVER_RATING_SOURCE_UNAVAILABLE'].includes(code)){
        return reply(404,{success:false,code});
      }
      if (typeof code==='string' && (/^DRIVER_(QUALITY|TIMING|RATING)_/.test(code) || ['EXCEPTION_EVIDENCE_REQUIRED','INDEPENDENT_EVIDENCE_REQUIRED'].includes(code))){
        return reply(409,{success:false,code});
      }
      if (['TransactionCanceledException','ConditionalCheckFailedException'].includes(error.name)){
        return reply(409,{success:false,code:'DRIVER_QUALITY_REVIEW_CONFLICT'});
      }
      console.warn('driver quality request failed',{path,errorType:error.name});
      return reply(503,{success:false,code:'QUALITY_UNAVAILABLE'});
    }
  };
}

let runtime:ReturnType<typeof createProductionDriverQuality>;
export async function handler(event:Row) {
  if(process.env.ENVIRONMENT!=='production'||process.env.AWS_REGION!=='us-east-1'){
    return reply(503,{success:false,code:'QUALITY_UNAVAILABLE'});
  }
  if(!runtime){
    const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
    const cognito=new CognitoIdentityProviderClient({maxAttempts:2});
    runtime=createProductionDriverQuality(db,(token,kind)=>authenticateFinancialIdentity(cognito,token,kind));
  }
  return runtime(event);
}
