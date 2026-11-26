import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { authenticateFinancialIdentity } from './financialIdentity';
import { checkoutTables, dispatchRegionTables } from './checkoutTables';
import { createDynamoRegionCoverage } from './regionCoverage';
import { createProductionDriverMap } from './productionDriverMap';
import { productionDriverHistory } from './productionDriverHistory';
import { exactCheck, strongGet, updateChecked, FinancialRow as Row } from './driverFinancialTransaction';

const vehicles = require('../../shared/driver-vehicles-308');
const mapActivity = require('../../shared/production-driver-map-activity');
const mapTools = require('../../shared/driver-map-settings-329');
const workRegions = require('../../shared/driver-work-region-311');
const { PRODUCTION_SNAPSHOT_TABLE, readSnapshot, viewForRules } = require('../../shared/driver-performance-snapshot');
const {readDemand} = require('../../shared/production-driver-demand');
const tables = {
  profile: 'wizz-production-Drivers',
  live: 'wizz-production-DriverLiveState',
  deletion: 'wizz-production-AccountDeletion',
};
type DB = Pick<DynamoDBDocumentClient, 'send'>;
type Point = {lat:number;lng:number};
type Area = { id:string;name:string;districtId:string;districtName:string;governorateId:string;governorateName:string };
type Permission = { allowed:boolean;code:string;guards:Row[] };

const paths = new Map([
  ['/driver/search-eligibility','GET'],
  ['/driver/performance','GET'],
  ['/driver/map-data','GET'],
  ['/driver/map-activity','POST'],
  ['/driver/trips','GET'],
  ['/driver/trips/{orderId}','GET'],
  ['/driver/demand-forecast','GET'],
  ['/driver/start-searching','POST'],
  ['/driver/stop-searching','POST'],
  ['/driver/update-location','POST'],
]);
const response = (statusCode:number,data:Row) => ({
  statusCode, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
  body:JSON.stringify(data),
});
const error = (status:number,code:string,message:string) => response(status,{success:false,code,message});
const id = (value:unknown):value is string => typeof value==='string' && /^[A-Za-z0-9_.:-]{1,150}$/.test(value);
const coords = (p:Row) => typeof p.lat==='number' && Number.isFinite(p.lat) && Math.abs(p.lat)<=90 &&
  typeof p.lng==='number' && Number.isFinite(p.lng) && Math.abs(p.lng)<=180;
const busy = (state:Row) => state.currentOrderId!=null || (state.activeOrdersCount??0)!==0 || state.status==='busy';
const approved = (profile:Row,driverId:string) => profile.driverId===driverId &&
  (profile.cognitoSub===undefined || profile.cognitoSub===driverId) &&
  profile.isActive===true && profile.isVerified===true &&
  ['APPROVED','VERIFIED'].includes(String(profile.status || profile.registrationStatus).toUpperCase()) &&
  !profile.isBanned && !profile.isSuspended;
const lifecycleKey = (driverId:string) => ({pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'});

function readBody(event:Row):Row | null {
  if (event.isBase64Encoded || typeof event.body!=='string' || Buffer.byteLength(event.body)>8192) return null;
  try {
    const parsed=JSON.parse(event.body);
    return parsed && typeof parsed==='object' && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function headersToken(event:Row) {
  const headers=Object.entries(event.headers??{}).filter(([key])=>key.toLowerCase()==='authorization');
  const multi=Object.entries(event.multiValueHeaders??{}).filter(([key])=>key.toLowerCase()==='authorization');
  if(headers.length!==1||multi.length>1||multi.some(([,value])=>!Array.isArray(value)||value.length!==1||value[0]!==headers[0][1])) return;
  const value=headers[0][1];
  return typeof value==='string'&&value.length<=16000 ? /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/.exec(value)?.[1] : undefined;
}

function regionPayload(area:Area) {
  return {id:area.id,name:area.name,district_name:area.districtName,governorate_name:area.governorateName};
}

export function createProductionDriverSearch({db,authenticate,locate,checkRegion,loadMap=createProductionDriverMap(db),now=Date.now}:{
  db:DB;authenticate:(accessToken:string)=>Promise<{subjectId:string}>;
  locate:(point:Point)=>Promise<Area|null>;
  checkRegion:(profile:Row,area:Area,point:Point)=>Promise<Permission>;
  loadMap?:(point:Point,regionId:string)=>Promise<Row>;
  now?:()=>number;
}) {
  return async (event:Row) => {
    const path=event?.resource;
    if (event?.requestContext?.stage!=='production' || !paths.has(path)) return error(404,'NOT_FOUND','المسار غير متاح.');
    if(paths.get(path)!==event.httpMethod) return error(405,'METHOD_NOT_ALLOWED','الإجراء غير متاح.');
    const token=headersToken(event);
    if(!token) return error(401,'AUTH_REQUIRED','يرجى تسجيل الدخول.');
    try {
      const actionTime=now(),at=new Date(actionTime).toISOString();
      const {subjectId:driverId}=await authenticate(token);
      if(!id(driverId)) return error(401,'AUTH_REQUIRED','يرجى تسجيل الدخول.');
      const key={driverId},lifecycle=lifecycleKey(driverId);
      const [profile,closing]=await Promise.all([
        strongGet(db,tables.profile,key),strongGet(db,tables.deletion,lifecycle),
      ]);
      if(!profile||profile.driverId!==driverId) return error(404,'DRIVER_NOT_FOUND','حساب السائق غير متاح.');
      if(closing||profile.deletionRequestId||profile.isDeleted||profile.deletedAt) return error(409,'ACCOUNT_CLOSING','الحساب قيد الإغلاق.');
      if (path === '/driver/performance') {
        if (profile.cognitoSub !== undefined && profile.cognitoSub !== driverId) {
          return error(403,'DRIVER_NOT_FOUND','حساب السائق غير متاح.');
        }
        const version = event.queryStringParameters?.rules ?? '1';
        if (!['1','2','3','4'].includes(version)) return error(400,'INVALID_REQUEST','الإصدار المطلوب غير متاح.');
        const snapshot = await readSnapshot({db,GetCommand,driverId,table:PRODUCTION_SNAPSHOT_TABLE,now});
        if (await strongGet(db,tables.deletion,lifecycle)) return error(409,'ACCOUNT_CLOSING','الحساب قيد الإغلاق.');
        return response(200,viewForRules(snapshot,Number(version)));
      }
      const driverApproved=approved(profile,driverId);
      if(path==='/driver/trips'||path==='/driver/trips/{orderId}'){
        if(!driverApproved) return error(403,'DRIVER_NOT_VERIFIED','حساب السائق غير متاح للعمل.');
        const detail=path.endsWith('/{orderId}');
        if(detail && typeof event.pathParameters?.orderId!=='string'){
          return error(404,'TRIP_UNAVAILABLE','الرحلة غير متاحة.');
        }
        const history=await productionDriverHistory(db,driverId,event.queryStringParameters??{},detail?event.pathParameters.orderId:undefined);
        return response(history.status,history.data);
      }
      if(path==='/driver/map-activity'){
        if(!driverApproved) return error(403,'DRIVER_NOT_VERIFIED','حساب السائق غير متاح للعمل.');
        const input=readBody(event);
        try {
          const result=await mapActivity.readActivity({db,GetCommand,QueryCommand,driverId,input,
            tables:{drivers:tables.profile,orders:'wizz-production-Orders',businesses:'wizz-production-Merchants',
              staff:'wizz-production-PlatformStaff'},now:()=>new Date(actionTime),
            regionAccess:workRegions.create({db,GetCommand,tables:dispatchRegionTables()}),
          });
          return response(200,result);
        } catch (failure) {
          const code=(failure as {code?:string}).code;
          if(code==='MAP_ACTIVITY_INVALID_REQUEST') return error(400,code,'بيانات الفروع غير صالحة.');
          if(code==='MAP_ACTIVITY_DRIVER_UNAVAILABLE') return error(403,code,'منطقة عمل السائق غير متاحة.');
          throw failure;
        }
      }
      if(path==='/driver/map-data'||path==='/driver/demand-forecast'){
        if(!driverApproved) return error(403,'DRIVER_NOT_VERIFIED','حساب السائق غير متاح للعمل.');
        if(path==='/driver/demand-forecast'){
          const demand=await readDemand({db,GetCommand,driverId,now:new Date(actionTime),tables:{
            drivers:tables.profile,live:tables.live,regions:'wizz-production-RegionsDerived',
            demand:'wizz-production-DriverDemand',dataset:'LIVE',
          }});
          return response(demand.statusCode,demand.result);
        }
        const input=event.queryStringParameters??{};
        if(typeof input.lat!=='string'||typeof input.lng!=='string'||!input.lat.trim()||!input.lng.trim()){
          return error(400,'INVALID_REQUEST','بيانات الموقع غير صالحة.');
        }
        const point={lat:Number(input.lat),lng:Number(input.lng)};
        if(!coords(point)) return error(400,'INVALID_REQUEST','بيانات الموقع غير صالحة.');
        const area=await locate(point);
        if(!area) return error(404,'OUTSIDE_SERVICE_AREA','موقعك الحالي خارج مناطق الخدمة.');
        const [data, mapPolicy] = await Promise.all([
          loadMap(point,area.id),
          mapTools.readPolicy(db, GetCommand, 'wizz-production-PlatformStaff').catch(() => null),
        ]);
        return response(200,{success:true,timestamp:at,
          current_work_region:{...regionPayload(area),level:3,parent_id:area.districtId,governorate_id:area.governorateId},
          ...data,map_tools:mapPolicy});
      }
      const eligibility=vehicles.enforce(profile)?vehicles.eligibility(profile,actionTime):{eligible:true};
      if(path==='/driver/search-eligibility') {
        return response(200,{success:true,data:{isVerified:driverApproved&&eligibility.eligible,
          ...(driverApproved&&!eligibility.eligible?{eligibilityCode:eligibility.code}:{})}});
      }
      const input=readBody(event);
      if(!input) return error(400,'INVALID_REQUEST','بيانات الطلب غير صالحة.');
      const stop=path==='/driver/stop-searching', start=path==='/driver/start-searching';
      if(stop ? Object.keys(input).length!==0 : !coords(input)) {
        return error(400,'INVALID_REQUEST','بيانات الموقع غير صالحة.');
      }
      if(start&&!driverApproved) return error(403,'DRIVER_NOT_VERIFIED','حسابك بانتظار موافقة الإدارة على استقبال الطلبات.');
      if(start&&!eligibility.eligible) return error(403,eligibility.code,'تحتاج المركبة أو الوثائق إلى مراجعة.');
      const state=await strongGet(db,tables.live,key)??{};
      if(stop&&busy(state)) return error(400,'ACTIVE_ORDER','لا يمكن إيقاف البحث أثناء تنفيذ طلب نشط.');
      if(stop&&!state.isSearching&&state.status!=='available') {
        return response(200,{success:true,message:'البحث متوقف.',data:{stoppedAt:at,hadPendingOffer:false}});
      }
      if(!start&&!stop&&!state.driverId) return error(404,'DRIVER_STATE_REQUIRED','ابدأ البحث أولًا.');
      if(!stop && typeof state.locationUpdatedAt==='string' && state.locationUpdatedAt>at) {
        return error(409,'STATE_CHANGED','وصل تحديث أحدث للموقع.');
      }

      const changes:Row={lastUpdated:at};
      let area:Area|null=null;
      let permission:Permission|undefined;
      let stopped=false;
      if(stop) {
        Object.assign(changes,{status:'offline',isSearching:false,isActive:false,searchStoppedAt:at,
          currentWaveOfferId:null,stopReason:'manual_stop'});
      } else {
        const point={lat:input.lat,lng:input.lng};
        Object.assign(changes,point,{locationUpdatedAt:at});
        if(!busy(state)||start){
          area=await locate(point);
          permission=area ? await checkRegion(profile,area,point)
            : {allowed:false,code:'OUTSIDE_SERVICE_AREA',guards:[]};
          if(start&&!permission.allowed) return error(permission.code==='OUTSIDE_SERVICE_AREA'?400:403,
            permission.code,'موقعك الحالي خارج منطقة العمل المتاحة لك.');
          const allowed=permission.allowed&&driverApproved&&eligibility.eligible;
          Object.assign(changes,{current_work_region_id:area?.id??null,
            allowed_region_ids:allowed?[area!.id]:[],
            allowed_region_ids_priority0:allowed?[area!.id]:[],
            allowed_region_ids_priority1:[]});
          if(start){
            Object.assign(changes,{isSearching:true,isActive:true,status:busy(state)?'busy':'available',
              parent_district_id:area!.districtId,governorate_id:area!.governorateId,
              home_region_id:profile.home_region_id??profile.work_region_id,
              region_mode:area!.id===profile.home_region_id?'home':'custom',
              searchStartedAt:state.isSearching&&state.searchStartedAt?state.searchStartedAt:at,
              lastOnlineAt:at});
            if(!state.isSearching&&!busy(state)) changes.currentWaveOfferId=null;
          } else if(!allowed&&(state.isSearching===true||state.status==='available')){
            stopped=true;
            Object.assign(changes,{status:'offline',isSearching:false,isActive:false,searchStoppedAt:at,
              stopReason:!driverApproved?'DRIVER_NOT_VERIFIED':!eligibility.eligible?eligibility.code:permission.code});
          }
        } else if(id(input.orderId)&&input.orderId===state.currentOrderId &&
            typeof input.accuracy==='number'&&input.accuracy>=0&&input.accuracy<=100 &&
            typeof input.heading==='number'&&input.heading>=0&&input.heading<360 &&
            typeof input.observedAt==='string'&&Number.isFinite(Date.parse(input.observedAt))&&
            Date.parse(input.observedAt)>=actionTime-30000&&Date.parse(input.observedAt)<=actionTime+5000 &&
            !(Date.parse(state.tripLocation438?.observedAt)>=Date.parse(input.observedAt))) {
          changes.tripLocation438={orderId:input.orderId,...point,
            accuracy:input.accuracy,heading:input.heading,observedAt:input.observedAt};
        }
      }
      const names:Row={},values:Row={};
      const set=Object.entries(changes).map(([field,value],index)=>{
        const name='#u'+index,param=':u'+index;names[name]=field;values[param]=value;
        return name+'='+param;
      });
      const liveGuard=exactCheck(tables.live,key,state,['driverId','status','isActive','isSearching',
        'currentOrderId','activeOrdersCount','currentWaveOfferId','locationUpdatedAt']);
      await db.send(new TransactWriteCommand({TransactItems:[
        {ConditionCheck:{TableName:tables.deletion,Key:lifecycle,ConditionExpression:'attribute_not_exists(pk)'}},
        exactCheck(tables.profile,key,profile,['driverId','cognitoSub','status','registrationStatus','isActive',
          'isVerified','isBanned','isSuspended','deletionRequestId','isDeleted','deletedAt','work_region_id',
          'home_region_id','vehicleOperational','vehicleRegistry','vehicleType','personalDocumentReview','vehiclePlate',
          'registrationPaperUrl','drivingLicenseUrl','nationalIdUrl']),
        ...(permission?.allowed?permission.guards:[]),
        updateChecked(liveGuard,'SET '+set.join(', '),names,values),
      ] as any}));
      if(stop) return response(200,{success:true,message:'تم إيقاف البحث عن الطلبات.',data:{
        searchDuration:Math.max(0,Math.floor((actionTime-(Date.parse(state.searchStartedAt)||actionTime))/1000)),
        hadPendingOffer:Boolean(state.currentWaveOfferId),stoppedAt:at}});
      if(start) return response(200,{success:true,status:'searching',message:'تم تفعيل البحث عن الطلبات.',
        data:{current_work_region:regionPayload(area!),driver_level:profile.level??'Bronze',started_at:changes.searchStartedAt}});
      return response(stopped?403:200,{success:!stopped,location_updated:true,searching_stopped:stopped,
        region_changed:!busy(state)&&state.current_work_region_id!==(area?.id??null),
        ...(stopped?{code:changes.stopReason,message:'أُوقف البحث لأن نطاق العمل الحالي غير متاح.'}:{}),
        data:{current_work_region:area?regionPayload(area):null}});
    } catch(err:any) {
      if(err.code==='UNAUTHORIZED'||['NotAuthorizedException','UserNotFoundException','UserNotConfirmedException'].includes(err.name)) {
        return error(401,'AUTH_REQUIRED','يرجى تسجيل الدخول.');
      }
      if(['TransactionCanceledException','ConditionalCheckFailedException'].includes(err.name)) {
        return error(409,'STATE_CHANGED','تغيّرت حالة السائق أثناء العملية. حاول مجددًا.');
      }
      return error(503,'DRIVER_SEARCH_UNAVAILABLE','تعذر تحديث حالة البحث. حاول مجددًا.');
    }
  };
}

let runtime:ReturnType<typeof createProductionDriverSearch>;
export async function handler(event:Row) {
  if(process.env.ENVIRONMENT!=='production'||process.env.AWS_REGION!=='us-east-1'||
      process.env.DRIVER_USER_POOL_ID!=='us-east-1_5sUT54eCB'||
      process.env.DRIVER_CLIENT_ID!=='59to4hbat3lv2fvosa49afu0gi') {
    return error(503,'DRIVER_SEARCH_UNAVAILABLE','خدمة البحث غير متاحة.');
  }
  if(!runtime) {
    const db=DynamoDBDocumentClient.from(new DynamoDBClient({maxAttempts:2}));
    const cognito=new CognitoIdentityProviderClient({maxAttempts:2});
    const regions=checkoutTables();
    const resolve=createDynamoRegionCoverage({db,tables:regions});
    runtime=createProductionDriverSearch({db,authenticate:token=>authenticateFinancialIdentity(cognito,token,'DRIVER'),
      locate:async ({lat,lng})=>{
        const coverage=await resolve({latitude:lat,longitude:lng});
        if(!coverage) return null;
        const [,governorateId,districtId,id]=coverage.regionPath;
        const names=await Promise.all([id,districtId,governorateId].map(async regionId=>{
          const row=await strongGet(db,regions.regions,{regionId});
          return row?.name_ar??row?.name??regionId;
        }));
        return {id,name:names[0],districtId,districtName:names[1],governorateId,governorateName:names[2]};
      },
      checkRegion:(profile,area,point)=>workRegions.create({db,GetCommand,tables:dispatchRegionTables()})
        .check(profile,area.id,area.id,1,point),
    });
  }
  return runtime(event);
}
