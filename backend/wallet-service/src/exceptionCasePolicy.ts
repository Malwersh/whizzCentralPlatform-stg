import {GetCommand,DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {quoteHash} from './deliveryQuoteRecord';
export const CASE_POLICY_PK='OPERATIONAL_SETTINGS#ORDER_EXCEPTION_CASES';
export const CASE_PRIORITIES=['SAFETY','CUSTODY','COD','FINANCIAL','STANDARD'] as const;
export const CASE_POLICY_DEFAULTS={sla:{SAFETY:{responseSeconds:60,escalationSeconds:300},CUSTODY:{responseSeconds:180,escalationSeconds:600},COD:{responseSeconds:300,escalationSeconds:900},FINANCIAL:{responseSeconds:14400,escalationSeconds:86400},STANDARD:{responseSeconds:86400,escalationSeconds:172800}},postDeliveryClaimSeconds:86400,appealSeconds:259200,lateSafetyAndCashReviewAllowed:true};
const bad=():never=>{throw Object.assign(Error('INVALID_EXCEPTION_CASE_POLICY'),{code:'INVALID_EXCEPTION_CASE_POLICY',status:400});};
export function validateExceptionCasePolicy(v:any){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='appealSeconds,lateSafetyAndCashReviewAllowed,postDeliveryClaimSeconds,sla'||v.lateSafetyAndCashReviewAllowed!==true||!v.sla||Object.keys(v.sla).sort().join(',')!==[...CASE_PRIORITIES].sort().join(','))return bad();
 for(const p of CASE_PRIORITIES){const r=v.sla[p];if(!r||typeof r!=='object'||Object.keys(r).sort().join(',')!=='escalationSeconds,responseSeconds'||!Number.isSafeInteger(r.responseSeconds)||!Number.isSafeInteger(r.escalationSeconds)||r.responseSeconds<30||r.escalationSeconds<r.responseSeconds||r.escalationSeconds>2592000)return bad();}
 for(const key of ['postDeliveryClaimSeconds','appealSeconds'])if(!Number.isSafeInteger(v[key])||v[key]<3600||v[key]>31536000)return bad();
 return JSON.parse(JSON.stringify(v)) as typeof CASE_POLICY_DEFAULTS;
}
export async function readExceptionCasePolicy(db:Pick<DynamoDBDocumentClient,'send'>){
 const key={pk:CASE_POLICY_PK,sk:'CURRENT'},row=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:key,ConsistentRead:true}))).Item;
 if(!row||!Number.isSafeInteger(row.version)||row.version<1||typeof row.policyVersion!=='string')throw Object.assign(Error('EXCEPTION_CASE_POLICY_UNAVAILABLE'),{code:'EXCEPTION_CASE_POLICY_UNAVAILABLE'});
 const values=validateExceptionCasePolicy(row.values),body={schemaVersion:1,version:row.version,policyVersion:row.policyVersion,values};return {snapshot:{...body,digest:quoteHash(body)},condition:{ConditionCheck:{TableName:'staging-PlatformStaff',Key:key,ConditionExpression:'#v=:v AND #p=:p AND #values=:values',ExpressionAttributeNames:{'#v':'version','#p':'policyVersion','#values':'values'},ExpressionAttributeValues:{':v':row.version,':p':row.policyVersion,':values':values}}}};
}
export function casePhase(snapshot:any,priority:typeof CASE_PRIORITIES[number],at:string){
 const {digest,...body}=snapshot??{};if(body.schemaVersion!==1||digest!==quoteHash(body))return bad();
 const values=validateExceptionCasePolicy(snapshot.values),rule=values.sla[priority],t=Date.parse(at);if(!rule||!Number.isFinite(t))return bad();
 return {priority,startedAt:at,responseDueAt:new Date(t+rule.responseSeconds*1000).toISOString(),escalationDueAt:new Date(t+rule.escalationSeconds*1000).toISOString(),policyVersion:snapshot.policyVersion};
}
