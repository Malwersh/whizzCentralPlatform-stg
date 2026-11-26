import {DynamoDBDocumentClient,GetCommand} from '@aws-sdk/lib-dynamodb';
import {OPERATIONS_PK,validateOperationsValues} from './deliveryOperationsPolicy';
import {financialOrderTables} from './walletBindings';
export async function readDeliveryOperations(db:Pick<DynamoDBDocumentClient,'send'>,env:NodeJS.ProcessEnv=process.env){
 const mode=env.DELIVERY_OPERATIONS_MODE??'ENV';
 if(mode==='ENV')return {version:0,values:validateOperationsValues({quoteMaxPerCustomerPerMinute:Number(env.DELIVERY_QUOTE_MAX_PER_MINUTE??5),driverOfferTtlSeconds:Number(env.FINANCIAL_OFFER_TTL_SECONDS??60),driverPositionMaxAgeSeconds:Number(env.FINANCIAL_POSITION_MAX_AGE_SECONDS??120),reassignmentWindowSeconds:Number(env.FINANCIAL_REASSIGNMENT_WINDOW_SECONDS??300),maximumWaves:4}),condition:null};
 if(mode!=='CENTRAL')throw Error('DELIVERY_OPERATIONS_UNAVAILABLE');
 try{
  const table=financialOrderTables(env).staff;
  const key={pk:OPERATIONS_PK,sk:'CURRENT'},row=(await db.send(new GetCommand({TableName:table,Key:key,ConsistentRead:true}))).Item;
  if(!row||!Number.isSafeInteger(row.version)||row.version<1)throw Error();
  const values=validateOperationsValues(row.values);
  return {version:row.version,values,condition:{ConditionCheck:{TableName:table,Key:key,ConditionExpression:'#v=:v AND #values=:values',ExpressionAttributeNames:{'#v':'version','#values':'values'},ExpressionAttributeValues:{':v':row.version,':values':values}}}};
 }catch{throw Error('DELIVERY_OPERATIONS_UNAVAILABLE');}
}
