import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateFinancialIdentity } from './financialIdentity';
import { createFinanceRollout } from './financeRollout';
import { createStagingDriverOfferAcceptance } from './driverOfferAcceptance';
import { createStagingDriverOfferContext } from './driverOfferContext';
import { createStagingFinancialOfferHydration } from './financialOfferHydration';
import { readFinancialPushReference } from './financialPushReference';
import { quoteEntityIdValid } from './deliveryQuoteRecord';
import { headersToken } from './productionDriverSearch';
import { createProductionDriverActiveOrder } from './productionDriverActiveOrder';
import { FinancialRow as Row } from './driverFinancialTransaction';
import { createProductionDriverTrip, isTripAction } from './productionDriverTrip';
import { financialDispatchTables } from './walletBindings';
const { acknowledgeDisplayedOffer } = require('../../../../whizzDrivers-stg/backend/driver-offer-display-receipt');

const paths = new Map<string,'read'|'accept'|'decline'|'active'|'detail'|'trip'|'display'>([
  ['/driver/financial-wave-offer','read'],
  ['/driver/accept-wave-offer','accept'],
  ['/driver/reject-wave-offer','decline'],
  ['/driver/active-order','active'],
  ['/driver/orders/{orderId}','detail'],
  ['/driver/orders/{orderId}/{tripAction}','trip'],
  ['/driver/offers/displayed','display'],
]);
const reply=(statusCode:number,data:Row)=>({
  statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
  body:JSON.stringify(data),
});
const fail=(status:number,code:string,message:string)=>reply(status,{success:false,code,message});
type Actor={driverId:string;subjectId:string};
type Decision={orderId:string;offerId:string;waveNumber:number};
type Read=(input:Row,actor:Actor)=>Promise<Row>;
type Respond=(action:'accept'|'decline',input:Decision,actor:Actor,verify:()=>Promise<Actor>)=>Promise<Row>;

export function createProductionDriverOffers({authenticate,read,respond,readOrder,trip,display}:{
  authenticate:(token:string)=>Promise<{subjectId:string}>;read:Read;respond:Respond;
  readOrder:(driverId:string,orderId?:string)=>Promise<Row>;
  trip?:ReturnType<typeof createProductionDriverTrip>;
  display?:(input:Row,actor:Actor)=>Promise<Row>;
}) {
  return async (event:Row)=>{
    const action=paths.get(event?.resource);
    if(event?.requestContext?.stage!=='production'||!action) return fail(404,'NOT_FOUND','المسار غير متاح.');
    const isOrderRead=action==='active'||action==='detail';
    if(event.httpMethod!==(isOrderRead?'GET':'POST')) return fail(405,'METHOD_NOT_ALLOWED','الإجراء غير متاح.');
    const token=headersToken(event);
    if(!token) return fail(401,'AUTH_REQUIRED','يرجى تسجيل الدخول.');
    let body:Row={};
    try {
      if(!isOrderRead){
      const noBodyTrip=action==='trip' && (event.body==null||event.body==='') && !event.isBase64Encoded;
      if(!noBodyTrip){
        if(event.isBase64Encoded||typeof event.body!=='string'||Buffer.byteLength(event.body)>8192) throw Error();
        body=JSON.parse(event.body);
        if(!body||typeof body!=='object'||Array.isArray(body)) throw Error();
      }
      }
    } catch { return fail(400,'INVALID_FINANCIAL_ACCEPTANCE','بيانات العرض غير صالحة.'); }

    const verify=async ()=>{
      const {subjectId}=await authenticate(token);
      if(!quoteEntityIdValid(subjectId) || (body.driverId!==undefined&&body.driverId!==subjectId)) throw Error('UNAUTHORIZED');
      return {driverId:subjectId,subjectId};
    };
    try {
      const actor=await verify();
      if(isOrderRead) {
        const orderId=action==='detail'?event.pathParameters?.orderId:undefined;
        if(action==='detail'&&!quoteEntityIdValid(orderId)) return fail(400,'INVALID_ORDER','معرّف الطلب غير صالح.');
        return reply(200,await readOrder(actor.driverId,orderId));
      }
      if (action==='display') {
        if (!display) return fail(404,'NOT_FOUND','الإجراء غير متاح.');
        if (Object.keys(body).sort().join(',')!=='offerId,orderId' ||
            !quoteEntityIdValid(body.orderId) || !quoteEntityIdValid(body.offerId)) {
          return fail(400,'INVALID_OFFER_RECEIPT','بيانات العرض غير صالحة.');
        }
        return reply(200,await display(body,actor));
      }
      if(action==='trip') {
        const {orderId,tripAction}=event.pathParameters??{};
        if(!quoteEntityIdValid(orderId)||!isTripAction(tripAction)||!trip) return fail(404,'NOT_FOUND','الإجراء غير متاح.');
        return reply(200,await trip(tripAction,orderId,body,actor,verify));
      }
      if(action==='read') {
        const reference=readFinancialPushReference(body);
        return reply(200,await read(reference,actor));
      }
      const {orderId,offerId,waveNumber}=body;
      const allowed=action==='accept'?['orderId','offerId','waveNumber','driverId']:['orderId','offerId','waveNumber','driverId','reason'];
      if(Object.keys(body).some(key=>!allowed.includes(key))||!quoteEntityIdValid(orderId)||
          !quoteEntityIdValid(offerId)||!offerId.startsWith('FINO:')||!Number.isSafeInteger(waveNumber)||waveNumber<1||waveNumber>1000||
          (body.reason!==undefined&&(typeof body.reason!=='string'||body.reason.length>500))) {
        return fail(400,'INVALID_FINANCIAL_ACCEPTANCE','بيانات العرض غير صالحة.');
      }
      return reply(200,await respond(action,{orderId,offerId,waveNumber},actor,verify));
    } catch(error:any) {
      const code=error.code??error.message;
      if(code==='UNAUTHORIZED'||['NotAuthorizedException','UserNotFoundException','UserNotConfirmedException'].includes(error.name)) {
        return fail(401,'AUTH_REQUIRED','يرجى تسجيل الدخول.');
      }
      if(code==='OFFER_RECEIPT_FORBIDDEN'||code==='OFFER_RECEIPT_UNAVAILABLE') return fail(404,code,'العرض غير متاح.');
      if(code==='ORDER_NOT_FOUND') return fail(404,code,'الطلب غير متاح لهذا الحساب.');
      if(code==='ACTIVE_ASSIGNMENT_CHANGED') return fail(409,code,'تغيّرت حالة الإسناد. حدّث الطلب.');
      if(code==='INVALID_TRIP_UPDATE') return fail(400,code,'بيانات تحديث الرحلة غير صالحة.');
      if(code==='COD_CASH_CONFIRMATION_MISMATCH') return fail(409,code,'تحقّق من مبلغ الطلب وأكّد استلام النقد.');
      if(action==='trip' && (code?.startsWith('FULL_CASH_')||code==='COD_RETURN_CONFLICT')) {
        return fail(409,'TRIP_UPDATE_CONFLICT','تعذر تأكيد حالة الطلب. حدّث الطلب وأعد المحاولة.');
      }
      if(code==='INSUFFICIENT_BALANCE') return fail(409,code,'الرصيد غير كافٍ لتأكيد العرض.');
      if(code==='DRIVER_WALLET_UNAVAILABLE') return fail(409,code,'محفظة السائق غير متاحة.');
      if(code==='FINANCIAL_ACCEPTANCE_CONFLICT') return fail(409,code,'تغيّرت حالة العرض أو انتهت مدته.');
      if(code==='FINANCIAL_PUSH_NOT_ALLOWED'||code==='FINANCIAL_OFFER_NOT_AVAILABLE'||
          code==='FINANCE_ROLLOUT_OUT_OF_SCOPE') return fail(409,'FINANCIAL_OFFER_NOT_AVAILABLE','العرض غير متاح.');
      return fail(503,'FINANCIAL_ACCEPTANCE_UNAVAILABLE','تعذر تأكيد حالة العرض. أعد المحاولة.');
    }
  };
}

let runtime:ReturnType<typeof createProductionDriverOffers>;
export async function handler(event:Row) {
  const env=process.env;
  if(env.ENVIRONMENT!=='production'||env.AWS_REGION!=='us-east-1'||env.FINANCIAL_COD_ACCOUNT_ID!=='746727375268'||
      env.FINANCE_GENERAL_RELEASE_MODE!=='REQUIRED'||env.FINANCIAL_SETTLEMENT_MODEL!=='FULL_CASH_AT_DELIVERY_V1'||
      env.FINANCIAL_DELIVERY_FUNDING_MODE!=='REQUIRED'||env.DRIVER_USER_POOL_ID!=='us-east-1_5sUT54eCB'||
      env.DRIVER_CLIENT_ID!=='59to4hbat3lv2fvosa49afu0gi') {
    return fail(503,'FINANCIAL_ACCEPTANCE_UNAVAILABLE','خدمة العروض غير متاحة.');
  }
  if(!runtime) {
    const raw=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}),{marshallOptions:{removeUndefinedValues:true}});
    const cognito=new CognitoIdentityProviderClient({maxAttempts:2});
    const options={enableFullCash:true,enableDeliveryFunding:true};
    const context=(db:Pick<DynamoDBDocumentClient,'send'>,age:number)=>createStagingDriverOfferContext({
      db,cognito,positionMaxAgeSeconds:age,offerTtlSeconds:60,...options,
      router:{async getRoute(){throw Error('ACCEPTANCE_MUST_NOT_REPRICE');}},
    });
    const readOrder=createProductionDriverActiveOrder({db:raw});
    runtime=createProductionDriverOffers({
      authenticate:token=>authenticateFinancialIdentity(cognito,token,'DRIVER'),
      readOrder,
      trip:createProductionDriverTrip({db:raw,readOrder}),
      display:async (input,actor)=>{
        const rollout=createFinanceRollout({db:raw,dispatch:true});
        await rollout.order(input.orderId,'DRAIN');
        rollout.driver(input.orderId,actor.driverId,actor.subjectId);
        return acknowledgeDisplayedOffer({db:rollout.db,QueryCommand,GetCommand,TransactWriteCommand,
          driverId:actor.driverId,value:input,tables:financialDispatchTables()});
      },
      read:async (reference,actor)=>{
        const rollout=createFinanceRollout({db:raw,dispatch:true});
        return createStagingFinancialOfferHydration({db:rollout.db,...options,authenticate:async()=>actor,
          authorize:async ref=>{
            await rollout.order(ref.orderId,'DRAIN');
            rollout.driver(ref.orderId,ref.dispatchDriverId,ref.driverId);
          },
        })(reference);
      },
      respond:async (action,input,actor,verify)=>{
        const rollout=createFinanceRollout({db:raw,dispatch:true}), db=rollout.db;
        await rollout.order(input.orderId,action==='accept'?'ADMIT':'DRAIN');
        rollout.driver(input.orderId,actor.driverId,actor.subjectId);
        const service=createStagingDriverOfferAcceptance({db,...options,authenticateDriver:verify,
          context:context(db,120),
          contextForOffer:offer=>{
            const age=(Date.parse(offer.source.driver.expiresAt)-Date.parse(offer.source.driver.observedAt))/1000;
            if(!Number.isSafeInteger(age)||age<1||age>900) throw Error('FINANCIAL_ACCEPTANCE_CONFLICT');
            return context(db,age);
          },
        });
        return action==='accept'?service.accept(input):service.decline(input);
      },
    });
  }
  return runtime(event);
}
