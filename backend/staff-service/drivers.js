'use strict';
const {GetCommand,ScanCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {allowed}=require('./catalog');
const regions=require('./driver-regions');
const fail=(message,status=403)=>Object.assign(Error(message),{status});
const fields=['driverId','id','name','fullName','phoneNumber','phone','email','status','registrationStatus','isVerified','isOnline','vehicleType','governorate_id','governorate_name','work_region_id','work_region_name','home_region_id','home_region_name','parent_district_id','parent_district_name','city','home_address_text','profileSchemaVersion','updatedAt','createdAt','ordersCompleted','rating'];
const visible=d=>({...Object.fromEntries(fields.filter(k=>d[k]!==undefined).map(k=>[k,d[k]])),...(d.status||d.vehicleRegistry?{vehicleReviewSummary:require('../shared/driver-vehicles-308').reviewSummary(d)}:{})});
const inScope=(actor,d)=>allowed(actor,'drivers.read',typeof d.work_region_id==='string'?d.work_region_id:null);
async function all(db,table){let items=[],cursor;for(let page=0;page<100;page++){const r=await db.send(new ScanCommand({TableName:table,ExclusiveStartKey:cursor,Limit:100}));items.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(!cursor)return items;}throw fail('DATA_INCOMPLETE',503);}
async function route(ctx,actor,method,path,input){
 if(!allowed(actor,'drivers.read'))throw fail('PERMISSION_REQUIRED');
 if(method==='GET'&&path==='/staff/drivers')return {items:(await all(ctx.db,ctx.driversTable)).filter(d=>inScope(actor,d)).map(d=>{if(!actor.roles.includes('bootstrap_admin'))return visible(d);const {vehicleRegistry,vehicleOperational,...rest}=d;return {...rest,vehicleReviewSummary:require('../shared/driver-vehicles-308').reviewSummary(d)};})};
 const performancePath=path.match(/^\/staff\/drivers\/([A-Za-z0-9_.:-]+)\/performance$/);
 if(method==='GET'&&performancePath){
  const driverId=performancePath[1],profile=(await ctx.db.send(new GetCommand({TableName:ctx.driversTable,Key:{driverId},ConsistentRead:true}))).Item;
  if(!profile||!inScope(actor,profile))throw fail('DRIVER_UNAVAILABLE',404);
  return require('../shared/driver-performance-snapshot').readSnapshot({db:ctx.db,GetCommand,driverId});
 }
 if(method==='GET'&&path==='/staff/drivers/regions')return {base:await all(ctx.db,ctx.regionsTable),derived:await all(ctx.db,ctx.derivedTable)};
 if(method!=='POST'||path!=='/staff/drivers/edit')throw fail('NOT_FOUND',404);
 if(!allowed(actor,'drivers.edit'))throw fail('PERMISSION_REQUIRED');
 if(typeof input.driverId!=='string'||input.driverId.length>100)throw fail('INVALID_DRIVER',400);
 const {Item:before}=await ctx.db.send(new GetCommand({TableName:ctx.driversTable,Key:{driverId:input.driverId},ConsistentRead:true}));
 if(!before||!inScope(actor,before))throw fail('DRIVER_UNAVAILABLE',404);
 const data=input.values;
 if(!data||typeof data.name!=='string'||!data.name.trim()||data.name.length>150||typeof data.home_address_text!=='string'||!data.home_address_text.trim()||data.home_address_text.length>500)throw fail('INVALID_EDIT',400);
 const editable=['name','vehicleType','governorate_id','governorate_name','work_region_id','work_region_name','home_region_id','home_region_name','parent_district_id','parent_district_name','city','home_address_text','updatedAt','licenseNumber','nationalId'];
 if(Object.keys(data).some(k=>!editable.includes(k)))throw fail('FIELD_NOT_ALLOWED',400);
 if(typeof data.work_region_id!=='string'||!allowed(actor,'drivers.edit',data.work_region_id))throw fail('REGION_FORBIDDEN');
 const model=regions.hierarchy(await all(ctx.db,ctx.regionsTable),await all(ctx.db,ctx.derivedTable));
 let values;try{values=regions.updateValues(before,{name:data.name,vehicleType:data.vehicleType,governorateId:data.governorate_id,regionId:data.work_region_id,landmark:data.home_address_text},model);}catch(_){throw fail('INVALID_REGION_OR_VEHICLE',400);}
 values.fullName=values.name;
 for(const k of ['licenseNumber','nationalId'])if(data[k]!==undefined){if(typeof data[k]!=='string'||data[k].length>100)throw fail('INVALID_EDIT',400);values[k]=data[k];}
 if(before.updatedAt!==input.expectedUpdatedAt)throw fail('VERSION_CONFLICT',409);
 values.updatedAt=new Date().toISOString();const names={'#id':'driverId'},attrs={},sets=[];
 for(const [k,v] of Object.entries(values)){names['#'+k]=k;attrs[':'+k]=v;sets.push('#'+k+' = :'+k);}
 names['#updatedAt']='updatedAt';let condition='attribute_exists(#id)';
 if(before.updatedAt!==undefined){condition+=' AND #updatedAt = :old';attrs[':old']=before.updatedAt;}else condition+=' AND attribute_not_exists(#updatedAt)';
 await ctx.db.send(new TransactWriteCommand({TransactItems:[ctx.guard(actor),{Update:{TableName:ctx.driversTable,Key:{driverId:input.driverId},UpdateExpression:'SET '+sets.join(', '),ConditionExpression:condition,ExpressionAttributeNames:names,ExpressionAttributeValues:attrs}},ctx.audit(actor.employeeId,'DRIVER_EDITED',visible(before),visible({...before,...values}),ctx.id())]}));
 return {updated:true};
}
module.exports={route,visible,inScope};
