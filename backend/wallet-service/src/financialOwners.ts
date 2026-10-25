import {docClient, ScanCommand} from './db';
export function ownerRecords(type:string, row:any):any[] {
 const ids=type==='DRIVER'?[row.driverId]:type==='CUSTOMER'?[row.cognitoSub,row.userId]:[row.businessId];
 const rawName=type==='MERCHANT'?row.businessName:(row.name||row.fullName);
 const name=typeof rawName==='string'?rawName.trim():'';
 const phone=String(row.phoneNumber||row.phone||'').trim();
 return [...new Set(ids.filter(x=>typeof x==='string'&&x))].map(ownerId=>({ownerId,ownerType:type,name,phone}));
}
export async function financialOwners(){
 const sources=[['DRIVER',process.env.DRIVERS_TABLE,'driverId, #n, fullName, phone, phoneNumber'],['MERCHANT',process.env.MERCHANTS_TABLE,'businessId, businessName, phone, phoneNumber'],['CUSTOMER',process.env.CUSTOMERS_TABLE,'userId, cognitoSub, #n, fullName, phone, phoneNumber']];
 const groups=await Promise.all(sources.map(async([type,table,projection])=>{
  if(!table)throw Error('مصدر أسماء أصحاب المحافظ غير مهيأ');
  let cursor:any, pages=0;const records:any[]=[];
  do{const page=await docClient.send(new ScanCommand({TableName:table,ProjectionExpression:projection,ExpressionAttributeNames:projection!.includes('#n')?{'#n':'name'}:undefined,ExclusiveStartKey:cursor,Limit:100}));records.push(...(page.Items||[]).flatMap(row=>ownerRecords(type!,row)));cursor=page.LastEvaluatedKey;if(++pages>=100&&cursor)throw Error('تعذر إكمال تحميل أسماء أصحاب المحافظ');}while(cursor);
  return records;
 }));
 return {owners:groups.flat()};
}
