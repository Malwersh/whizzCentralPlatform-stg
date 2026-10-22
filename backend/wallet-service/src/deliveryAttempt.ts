import {DynamoDBDocumentClient,TransactWriteCommand} from '@aws-sdk/lib-dynamodb';
import {createCodFlowContext,ReturnActor} from './codFlowContext';
import {readOrderExceptionPolicy} from './orderExceptionPolicy';
import {readExceptionSettings,validateExceptionSettings} from './orderExceptionSettings';
import {quoteHash,quoteCanonical} from './deliveryQuoteRecord';
import {strongGet,exactCheck,updateChecked} from './driverFinancialTransaction';
type Row=Record<string,any>;
const fail=(code='DELIVERY_ATTEMPT_CONFLICT'):never=>{throw Object.assign(Error(code),{code});};
export const attemptKey=(orderId:string,attempt:number)=>({orderId,sk:'DELIVERY_ATTEMPT#'+attempt});
function exact(v:Row,fields:string[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==fields.sort().join(','))fail('INVALID_DELIVERY_ATTEMPT');return v;}
export function assertPosition(position:Row,customer:Row,settings:Row,at:number){
 exact(position,['latitude','longitude','accuracyMeters','capturedAt']);
 const {latitude:a,longitude:b,accuracyMeters:accuracy,capturedAt}=position;
 const valid=(n:any,min:number,max:number)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 if(!valid(a,-90,90)||!valid(b,-180,180)||!valid(accuracy,0,settings.maximumAccuracyMeters)||typeof capturedAt!=='string')return fail('ARRIVAL_LOCATION_REQUIRED');
 const t=Date.parse(capturedAt);if(!Number.isFinite(t)||at-t>settings.positionMaxAgeSeconds*1000||t-at>30000)return fail('ARRIVAL_LOCATION_STALE');
 if(!customer||!valid(customer.latitude,-90,90)||!valid(customer.longitude,-180,180))return fail('ARRIVAL_LOCATION_REQUIRED');
 const rad=(d:number)=>d*Math.PI/180,dlat=rad(customer.latitude-a),dlng=rad(customer.longitude-b),h=Math.sin(dlat/2)**2+Math.cos(rad(a))*Math.cos(rad(customer.latitude))*Math.sin(dlng/2)**2;
 const distance=2*6371000*Math.asin(Math.min(1,Math.sqrt(h)));
 // Accuracy is recorded separately; an imprecise fix cannot extend the radius.
 if(distance>settings.arrivalRadiusMeters)return fail('ARRIVAL_OUTSIDE_RADIUS');
 return {latitude:a,longitude:b,accuracyMeters:accuracy,capturedAt,distanceMeters:Math.ceil(distance),checkedAt:new Date(at).toISOString(),source:'DEVICE_REPORTED_LOCATION',verification:'SERVER_PROXIMITY_AND_FRESHNESS_CHECK'};
}
export function validateAttemptRecord(row:Row,c:Row){
 if(!row||row.kind!=='COD_DELIVERY_ATTEMPT'||row.schemaVersion!==1||row.orderId!==c.order.orderId||row.attempt!==c.order.assignmentAttemptCounter||row.offerId!==c.offer.offerId||row.offerDigest!==c.offer.digest||row.driverSubjectId!==c.subject||row.driverId!==c.order.driverId||!Number.isSafeInteger(row.version)||row.version<1||!Array.isArray(row.contacts)||row.contacts.length>10)return fail();
 const snap=row.settingsSnapshot;if(!snap||snap.schemaVersion!==1||!Number.isSafeInteger(snap.version)||snap.version<1||typeof snap.policyVersion!=='string')return fail();
 const values=validateExceptionSettings(snap.values),{digest,...body}=snap;if(digest!==quoteHash(body))return fail();
 const started=Date.parse(row.startedAt);if(!Number.isFinite(started)||Date.parse(row.deadlineAt)!==started+values.waitSeconds*1000||row.policyDigest!==readOrderExceptionPolicy(c.order)?.digest)return fail();
 let previous=-Infinity;const seen=new Set();for(const x of row.contacts){const t=Date.parse(x.recordedAt);if(!Number.isFinite(t)||t<started||t-previous<values.contactIntervalSeconds*1000||!['CALL_INITIATED','MESSAGE_INITIATED'].includes(x.channel)||typeof x.eventId!=='string'||seen.has(x.eventId)||x.actorId!==c.subject)return fail();previous=t;seen.add(x.eventId);}
 return values;
}
export function attemptView(row:Row,now:number){
 return {success:true,kind:'COD_DELIVERY_ATTEMPT',orderId:row.orderId,attempt:row.attempt,offerId:row.offerId,attemptId:row.attemptId,state:row.state,serverNow:new Date(now).toISOString(),startedAt:row.startedAt,deadlineAt:row.deadlineAt,settingsVersion:row.settingsSnapshot.version,waitSeconds:row.settingsSnapshot.values.waitSeconds,requiredContactAttempts:row.settingsSnapshot.values.minimumContactAttempts,contactCount:row.contacts.length,nextContactAt:row.contacts.length?new Date(Date.parse(row.contacts.at(-1).recordedAt)+row.settingsSnapshot.values.contactIntervalSeconds*1000).toISOString():row.startedAt,
  noResponseEligible:row.state==='WAITING'&&now>=Date.parse(row.deadlineAt)&&row.contacts.length>=row.settingsSnapshot.values.minimumContactAttempts,
  contacts:row.contacts.map((r:Row)=>({eventId:r.eventId,channel:r.channel,recordedAt:r.recordedAt})),contactEvidenceMeaning:'INITIATION_REPORTED_BY_DRIVER_NOT_CONNECTED_CALL_PROOF'};
}
export async function requireNoResponseAttempt(db:Pick<DynamoDBDocumentClient,'send'>,c:Row){
 const key=attemptKey(c.order.orderId,c.order.assignmentAttemptCounter),row=await strongGet(db,'staging-Holds',key);validateAttemptRecord(row!,c);
 if(!attemptView(row!,Date.parse(c.timestamp)).noResponseEligible)return fail('NO_RESPONSE_REQUIREMENTS_NOT_MET');
 return {row,key,operation:updateChecked(exactCheck('staging-Holds',key,row!), 'SET #state=:state, #authorizedAt=:at',{'#state':'state','#authorizedAt':'exceptionReportedAt'},{':state':'EXCEPTION_REPORTED',':at':c.timestamp})};
}
export function createDeliveryAttempt(options:{db:Pick<DynamoDBDocumentClient,'send'>;authenticate:()=>Promise<ReturnActor>;now?:()=>number;enableFullCash?:boolean;enableDeliveryFunding?:boolean}){
 const {db,authenticate}=options,now=options.now??Date.now,context=createCodFlowContext({...options,now});
 async function load(value:Row,extra:string[]){
  const v=exact(value,['orderId','offerId','attempt',...extra]);if(!Number.isSafeInteger(v.attempt)||v.attempt<1)return fail('INVALID_DELIVERY_ATTEMPT');
  const c=await context(v,'DRIVER');if(!readOrderExceptionPolicy(c.order))return fail('ORDER_EXCEPTION_POLICY_REQUIRED');
  return {v,c,key:attemptKey(v.orderId,v.attempt)};
 }
 function active(c:Row){if(c.order.status!=='arrived_at_customer'||c.order.financialOutcome!=null||c.order.returnCaseId!=null||c.order.cashCollected===true||Number(c.order.cashCollectedAmount??0)!==0)return fail();}
 function audit(c:Row,action:string,id:string){return {Put:{TableName:'staging-AuditLog',Item:{datePartition:'date#'+c.timestamp.slice(0,10).replace(/-/g,''),sk:c.timestamp+'#'+id,logId:id,orderId:c.order.orderId,actorId:c.subject,actorKind:'DRIVER',action,createdAt:c.timestamp},ConditionExpression:'attribute_not_exists(sk)'}};}
 async function commit(c:Row,operations:Row[]){if(quoteCanonical(await authenticate())!==quoteCanonical(c.actor))return fail('UNAUTHORIZED');await db.send(new TransactWriteCommand({TransactItems:[...c.guards,exactCheck('WizzOrders',c.key,c.order),...operations] as any}));}
 return {
  async start(value:Row){const {v,c,key}=await load(value,['position']);active(c);let row=await strongGet(db,'staging-Holds',key);if(row){validateAttemptRecord(row,c);return attemptView(row,now());}
   const settings=await readExceptionSettings(db),at=now(),position=assertPosition(v.position,c.offer.source.order.customerPoint,settings.snapshot.values,at);
   row={...key,kind:'COD_DELIVERY_ATTEMPT',schemaVersion:1,version:1,attemptId:'ATT:'+quoteHash({orderId:v.orderId,attempt:v.attempt,offerId:v.offerId}).slice(0,48),attempt:v.attempt,offerId:v.offerId,offerDigest:c.offer.digest,driverId:c.order.driverId,driverSubjectId:c.subject,policyDigest:c.order.exceptionPolicy.digest,settingsSnapshot:settings.snapshot,position,startedAt:new Date(at).toISOString(),deadlineAt:new Date(at+settings.snapshot.values.waitSeconds*1000).toISOString(),contacts:[],state:'WAITING',createdAt:c.timestamp};
   try{await commit(c,[settings.condition,{Put:{TableName:'staging-Holds',Item:row,ConditionExpression:'attribute_not_exists(orderId)'}},audit(c,'DELIVERY_ATTEMPT_STARTED',row.attemptId)]);}catch(e){const saved=await strongGet(db,'staging-Holds',key);if(!saved)throw e;validateAttemptRecord(saved,c);return attemptView(saved,now());}return attemptView(row,now());
  },
  async read(value:Row){const {c,key}=await load(value,[]),row=await strongGet(db,'staging-Holds',key);if(!row)return {success:true,orderId:c.order.orderId,exists:false};validateAttemptRecord(row,c);return {...attemptView(row,now()),exists:true};},
  async contact(value:Row){const {v,c,key}=await load(value,['eventId','channel']);if(typeof v.eventId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v.eventId)||!['CALL_INITIATED','MESSAGE_INITIATED'].includes(v.channel))return fail('INVALID_DELIVERY_ATTEMPT');
   const row=await strongGet(db,'staging-Holds',key);validateAttemptRecord(row!,c);const prior=row!.contacts.find((r:Row)=>r.eventId===v.eventId);if(prior){if(prior.channel!==v.channel)return fail();return attemptView(row!,now());}active(c);
   const view=attemptView(row!,now());if(row!.state!=='WAITING'||row!.contacts.length>=row!.settingsSnapshot.values.minimumContactAttempts||now()<Date.parse(view.nextContactAt))return fail('CONTACT_ATTEMPT_TOO_SOON');
   const {Key:_key,...fence}=exactCheck('staging-Holds',key,row!).ConditionCheck;
   const next={...row!,version:row!.version+1,contacts:[...row!.contacts,{eventId:v.eventId,channel:v.channel,recordedAt:c.timestamp,actorId:c.subject}],updatedAt:c.timestamp};
   try{await commit(c,[{Put:{...fence,Item:next}},audit(c,'DELIVERY_CONTACT_INITIATED',v.eventId)]);}catch(e){const saved=await strongGet(db,'staging-Holds',key);if(!saved)throw e;validateAttemptRecord(saved,c);if(saved.contacts.some((r:Row)=>r.eventId===v.eventId&&r.channel===v.channel))return attemptView(saved,now());throw e;}return attemptView(next,now());
  }
 };
}
