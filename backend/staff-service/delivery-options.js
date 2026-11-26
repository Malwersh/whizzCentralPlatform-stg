'use strict';
const {ScanCommand}=require('@aws-sdk/lib-dynamodb');
async function load(db){
 const rows=[];let cursor;
 for(let n=0;n<20;n++){
  const r=await db.send(new ScanCommand({TableName:'WizzCentral_Regions',ConsistentRead:true,Limit:100,ProjectionExpression:'regionId,parent_id,#level,#name,name_ar,is_active,isDeleted,deletedAt',ExpressionAttributeNames:{'#level':'level','#name':'name'},...(cursor?{ExclusiveStartKey:cursor}:{})}));
  rows.push(...r.Items||[]);cursor=r.LastEvaluatedKey;if(!cursor)break;
 }
 if(cursor)throw Object.assign(Error('DELIVERY_REGIONS_INCOMPLETE'),{status:503});
 const map=new Map(rows.map(r=>[r.regionId,r]));
 const active=r=>r&&[true,1,'true','1'].includes(r.is_active)&&!r.isDeleted&&!r.deletedAt;
 const result=[];
 for(const r of rows){
  if(r.level!==3||!active(r))continue;
  const path=[],seen=new Set();let node=r,expectedLevel=3,complete=false;
  while(node){if(node.level!==expectedLevel||seen.has(node.regionId)||!active(node)||typeof(node.name_ar||node.name)!=='string'){path.length=0;break;}seen.add(node.regionId);path.unshift(node.name_ar||node.name);if(expectedLevel===0){complete=true;break;}expectedLevel--;node=map.get(node.parent_id);}
  if(!complete)continue;
  result.push({id:r.regionId,label:path.join(' — ')});
 }
 return result.sort((a,b)=>a.label.localeCompare(b.label,'ar'));
}
module.exports={load};
