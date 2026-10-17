'use strict';
const {ScanCommand}=require('@aws-sdk/lib-dynamodb');
const FIELDS=['discountId','businessId','title','name','code','version','status','isActive','isDeleted','deletedAt','deletionRequestId','validFrom','validTo','valid_from','valid_to','startDate','endDate','fundingPolicyId','fundingPolicyVersion'];
const text=v=>typeof v==='string'?v.trim().slice(0,300):'';
async function load(db,businessId){
 const options=[];
 for(const [source,table]of [['MERCHANT','WhizzMerchants_Discounts'],['PLATFORM','WizzCentral_Platform_Discounts']]){
  let cursor,pages=0;
  do{
   const page=await db.send(new ScanCommand({TableName:table,Select:'SPECIFIC_ATTRIBUTES',ProjectionExpression:FIELDS.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:Object.fromEntries(FIELDS.map((f,i)=>['#f'+i,f])),Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
   for(const row of page.Items||[]){
    if(row.isDeleted||row.deletedAt||row.deletionRequestId||source==='MERCHANT'&&row.businessId!==businessId)continue;
    const id=text(row.discountId),name=text(row.title)||text(row.name),code=text(row.code);if(!id||!name&&!code)continue;
    options.push({key:source+':'+id,id,source,label:[name,code?'الكود '+code:''].filter(Boolean).join(' — ')+' — '+(source==='MERCHANT'?'خصم المتجر':'عرض المنصة'),version:Number.isSafeInteger(row.version)&&row.version>0?row.version:null,from:text(row.validFrom||row.valid_from||row.startDate),to:text(row.validTo||row.valid_to||row.endDate),status:row.isActive===false?'inactive':text(row.status),fundingPolicyId:text(row.fundingPolicyId)||null,fundingPolicyVersion:Number.isSafeInteger(row.fundingPolicyVersion)?row.fundingPolicyVersion:null});
   }
   cursor=page.LastEvaluatedKey;if(++pages>=20&&cursor)throw Object.assign(Error('COMMERCIAL_OPTIONS_TOO_LARGE'),{status:409});
  }while(cursor);
 }
 return options.sort((a,b)=>a.label.localeCompare(b.label,'ar'));
}
module.exports={load,FIELDS};
