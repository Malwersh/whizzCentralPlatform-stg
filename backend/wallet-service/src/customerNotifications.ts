import {docClient,TABLES,GetCommand,UpdateCommand,QueryCommand,TransactWriteCommand} from './db';
import {fundingError} from './fundingService';
const fail=()=>fundingError('تعذر تحديث الإشعار','NOTIFICATION_UNAVAILABLE',403);
export async function customerNotifications(subject:string,cursor?:string){
 let start:any;
 if(cursor){try{start=JSON.parse(Buffer.from(cursor,'base64url').toString());if(cursor.length>2048||start.driverId!==subject||Object.keys(start).sort().join(',')!=='createdAt,driverId,eventId'||typeof start.eventId!=='string'||typeof start.createdAt!=='string')throw Error();}catch{throw fundingError('مؤشر الصفحة غير صالح','INVALID_CURSOR',400);}}
 const readState=(await docClient.send(new GetCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:{idempotencyKey:`CUSTOMER_NOTIFICATION_READ#${subject}`,sk:'META'},ConsistentRead:true}))).Item;
 const r=await docClient.send(new QueryCommand({TableName:process.env.WALLET_NOTIFICATIONS_TABLE,IndexName:'ByDriver',KeyConditionExpression:'driverId = :subject',FilterExpression:'recipientApp = :app',ExpressionAttributeValues:{':subject':subject,':app':'user'},ScanIndexForward:false,Limit:30,ExclusiveStartKey:start}));
 return {notifications:(r.Items||[]).map(x=>({id:x.eventId,type:x.type,title:x.title,body:x.body,createdAt:x.createdAt,readAt:x.readAt||(Date.parse(x.createdAt)<=Date.parse(readState?.readThrough)?readState?.readThrough:null),transferId:x.transferId,amount:x.amount,source:'server',target:'wallet'})),nextCursor:r.LastEvaluatedKey?Buffer.from(JSON.stringify(r.LastEvaluatedKey)).toString('base64url'):null};
}
export async function readCustomerNotifications(subject:string,input:any){
 if(input.all===true){try{await docClient.send(new UpdateCommand({TableName:TABLES.IDEMPOTENCY_KEYS,Key:{idempotencyKey:`CUSTOMER_NOTIFICATION_READ#${subject}`,sk:'META'},UpdateExpression:'SET readThrough = :now',ConditionExpression:'attribute_not_exists(readThrough) OR readThrough <= :now',ExpressionAttributeValues:{':now':new Date().toISOString()}}));}catch(e:any){if(e.name!=='ConditionalCheckFailedException')throw e;}return {read:true};}
 if(!Array.isArray(input.eventIds)||input.eventIds.length<1||input.eventIds.length>50||input.eventIds.some((x:any)=>typeof x!=='string'||x.length>250||!x))throw fundingError('اختر إشعارات صالحة','INVALID_NOTIFICATION',400);
 const now=new Date().toISOString(),ids=[...new Set<string>(input.eventIds)];
 try{await docClient.send(new TransactWriteCommand({TransactItems:ids.map(eventId=>({Update:{TableName:process.env.WALLET_NOTIFICATIONS_TABLE,Key:{eventId},UpdateExpression:'SET readAt = if_not_exists(readAt, :now)',ConditionExpression:'attribute_exists(eventId) AND driverId = :subject AND recipientApp = :app',ExpressionAttributeValues:{':now':now,':subject':subject,':app':'user'}}}))}));}catch(e:any){if(e.name==='TransactionCanceledException')throw fail();throw e;}
 return {read:true};
}
