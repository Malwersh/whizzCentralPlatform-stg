'use strict';
const {QueryCommand,ScanCommand}=require('@aws-sdk/lib-dynamodb');
const limits=require('./funding-campaign-limits');
const stagingTables={MERCHANT:'WhizzMerchants_Discounts',PLATFORM:'WizzCentral_Platform_Discounts'};
const FIELDS=['discountId','businessId','title','name','code','version','status','isActive','isDeleted','deletedAt','deletionRequestId','validFrom','validTo','valid_from','valid_to','startDate','endDate','fundingPolicyId','fundingPolicyVersion','usage_limit','usageLimit','limit','perCustomerLimit','singleUse','maxDiscountAmount','maxDiscount','type','discountType','value','discountValue'];
const iso=v=>{try{return new Date(v).toISOString();}catch{return '';}};
const text=v=>typeof v==='string'?v.trim().slice(0,300):'';
async function load(db,businessId,tables=stagingTables){
 const options=[];
 const scoped=tables!==stagingTables;
 const fields=scoped?[...FIELDS,'benefit','targetRestaurants','allowedBusinessIds','businessIds']:FIELDS;
 for(const [source,table]of Object.entries(tables)){
  let cursor,pages=0;
  do{
   const request={TableName:table,Select:'SPECIFIC_ATTRIBUTES',ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),
    ExpressionAttributeNames:Object.fromEntries(fields.map((f,i)=>['#f'+i,f])),Limit:100,
    ...(cursor?{ExclusiveStartKey:cursor}:{})};
   const page=await db.send(scoped&&source==='MERCHANT'?new QueryCommand({...request,IndexName:'BusinessIdIndex',
    KeyConditionExpression:'#f'+fields.indexOf('businessId')+'=:business',
    ExpressionAttributeValues:{':business':businessId}}):new ScanCommand(request));
   for(const row of page.Items||[]){
    if(row.isDeleted||row.deletedAt||row.deletionRequestId||source==='MERCHANT'&&row.businessId!==businessId)continue;
    if(scoped&&source==='PLATFORM'){
     const targets=row.targetRestaurants?.length?row.targetRestaurants:row.allowedBusinessIds?.length?row.allowedBusinessIds:
      row.businessIds?.length?row.businessIds:row.businessId?[row.businessId]:[];
     if(!Array.isArray(targets)||targets.length&&!targets.includes(businessId))continue;
    }
    const id=text(row.discountId),name=text(row.title)||text(row.name),code=text(row.code);if(!id||!name&&!code)continue;
    let fundingError=null;try{if(scoped)limits.assertGoodsCampaign(row);limits.validate(row,source);}catch(e){fundingError=e.message;}
    options.push({fundingError,key:source+':'+id,id,source,label:[name,code?'الكود '+code:''].filter(Boolean).join(' — ')+' — '+(source==='MERCHANT'?'خصم المتجر':'عرض المنصة'),version:Number.isSafeInteger(row.version)&&row.version>0?row.version:null,from:iso(row.validFrom||row.valid_from||row.startDate),to:iso(row.validTo||row.valid_to||row.endDate),status:row.isActive===false?'inactive':text(row.status),usageLimit:source==='MERCHANT'?row.usage_limit??row.usageLimit??null:row.usageLimit??row.limit??null,perCustomerLimit:row.singleUse?1:row.perCustomerLimit??null,maxDiscountAmount:row.maxDiscountAmount??row.maxDiscount??null,fundingPolicyId:text(row.fundingPolicyId)||null,fundingPolicyVersion:Number.isSafeInteger(row.fundingPolicyVersion)?row.fundingPolicyVersion:null});
   }
   cursor=page.LastEvaluatedKey;if(++pages>=20&&cursor)throw Object.assign(Error('COMMERCIAL_OPTIONS_TOO_LARGE'),{status:409});
  }while(cursor);
 }
 return options.sort((a,b)=>a.label.localeCompare(b.label,'ar'));
}
module.exports={load,FIELDS};
