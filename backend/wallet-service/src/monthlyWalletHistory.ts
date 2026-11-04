import {docClient,QueryCommand,TABLES} from './db';
import {fundingError} from './fundingService';
const invalid=()=>{throw fundingError('اختر شهرًا صالحًا أو أعد تحميل الكشف','INVALID_STATEMENT',400);};
export function statementRange(month:string,now=new Date()){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return invalid();
 const [year,m]=month.split('-').map(Number);
 const start=new Date(Date.UTC(year,m-1,1,-3));
 const end=new Date(Date.UTC(year,m,1,-3));
 if(start>now)return invalid();
 return {start:start.toISOString(),end:end.toISOString()};
}
export async function monthlyWalletPage(walletId:string,month:string,cursor?:string,now=new Date()){
 const range=statementRange(month,now);let lastKey:any,asOf=now.toISOString();
 if(cursor){
  try{if(cursor.length>2048)return invalid();const c=JSON.parse(Buffer.from(cursor,'base64url').toString());
   if(c.walletId!==walletId||c.month!==month||typeof c.asOf!=='string'||!Number.isFinite(Date.parse(c.asOf))||new Date(c.asOf)>now||new Date(c.asOf)<new Date(range.start)||c.lastKey?.walletId!==walletId||typeof c.lastKey?.sk!=='string'||c.lastKey.sk<`ts#${range.start}`||c.lastKey.sk>=`ts#${range.end}`)return invalid();
   lastKey={walletId,sk:c.lastKey.sk};asOf=c.asOf;
  }catch{return invalid();}
 }
 // Baghdad month boundaries in UTC. '#' excludes rows at the exclusive upper timestamp.
 const upper=range.end<asOf?range.end:asOf;
 const r=await docClient.send(new QueryCommand({TableName:TABLES.LEDGER,KeyConditionExpression:'walletId = :w AND sk BETWEEN :start AND :end',ExpressionAttributeValues:{':w':walletId,':start':`ts#${range.start}#`,':end':`ts#${upper}#`},ExclusiveStartKey:lastKey,Limit:100,ScanIndexForward:false,ConsistentRead:true}));
 const nextToken=r.LastEvaluatedKey?Buffer.from(JSON.stringify({walletId,month,asOf,lastKey:r.LastEvaluatedKey})).toString('base64url'):undefined;
 return {transactions:r.Items||[],nextToken,month,timeZone:'Asia/Baghdad',asOf,start:range.start,end:range.end};
}
