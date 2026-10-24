import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {quoteHash} from './deliveryQuoteRecord';
export const EXCEPTION_SETTINGS_PK='OPERATIONAL_SETTINGS#ORDER_EXCEPTIONS';
export const EXCEPTION_SETTINGS_LIMITS={waitSeconds:[60,3600],minimumContactAttempts:[1,10],contactIntervalSeconds:[30,600],arrivalRadiusMeters:[25,1000],maximumAccuracyMeters:[5,200],positionMaxAgeSeconds:[15,300]} as const;
export const EXCEPTION_SETTINGS_DEFAULTS={waitSeconds:600,minimumContactAttempts:3,contactIntervalSeconds:60,arrivalRadiusMeters:100,maximumAccuracyMeters:50,positionMaxAgeSeconds:120};
const fail=():never=>{throw Object.assign(Error('INVALID_EXCEPTION_SETTINGS'),{status:400,code:'INVALID_EXCEPTION_SETTINGS'});};
export function validateExceptionSettings(v:any){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==Object.keys(EXCEPTION_SETTINGS_LIMITS).sort().join(','))return fail();
 for(const [k,[min,max]] of Object.entries(EXCEPTION_SETTINGS_LIMITS))if(!Number.isSafeInteger(v[k])||v[k]<min||v[k]>max)return fail();
 if((v.minimumContactAttempts-1)*v.contactIntervalSeconds>v.waitSeconds||v.maximumAccuracyMeters>v.arrivalRadiusMeters)return fail();
 return {...v} as typeof EXCEPTION_SETTINGS_DEFAULTS;
}
export async function readExceptionSettings(db:Pick<DynamoDBDocumentClient,'send'>){
 const key={pk:EXCEPTION_SETTINGS_PK,sk:'CURRENT'},row=(await db.send(new GetCommand({TableName:'staging-PlatformStaff',Key:key,ConsistentRead:true}))).Item;
 if(!row||!Number.isSafeInteger(row.version)||row.version<1||typeof row.policyVersion!=='string'||!row.policyVersion.length)throw Object.assign(Error('EXCEPTION_SETTINGS_UNAVAILABLE'),{code:'EXCEPTION_SETTINGS_UNAVAILABLE'});
 const values=validateExceptionSettings(row.values),body={schemaVersion:1,version:row.version,policyVersion:row.policyVersion,values};
 return {snapshot:{...body,digest:quoteHash(body)},condition:{ConditionCheck:{TableName:'staging-PlatformStaff',Key:key,ConditionExpression:'#v=:v AND #p=:p AND #values=:values',ExpressionAttributeNames:{'#v':'version','#p':'policyVersion','#values':'values'},ExpressionAttributeValues:{':v':row.version,':p':row.policyVersion,':values':values}}}};
}
