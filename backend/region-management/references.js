'use strict';

const references = {
  addresses: { label: 'عناوين زبائن', fields: ['regionId','region_id'] },
  merchants: { label: 'فروع مطاعم أو أنشطة', fields: ['regionId','region_id','address.regionId'], paths: ['regionPath'] },
  merchantPlatform: {
    label: 'طلبات فتح أو تعديل فروع',
    fields: ['regionId','submission.snapshot.regionId'],
    paths: ['regionPath','submission.snapshot.regionPath'],
    keep: '(attribute_not_exists(#purged) AND (attribute_not_exists(#review) OR NOT (#review IN (:rejected, :cancelled))))',
    guards: {'#purged':'deletedAt','#review':'reviewStatus'},
    guardValues: {':rejected':'REJECTED',':cancelled':'CANCELLED'},
  },
  drivers: {
    label: 'مناطق عمل سائقين',
    fields: ['work_region_id','workRegionId','home_region_id','governorate_id','parent_district_id','district_id','country_id'],
    paths: ['workRegionIds'],
  },
  orders: {
    label: 'طلبات جارية',
    fields: ['regionId','region_id','pickupRegionId','deliveryRegionId','dropoffRegionId','deliveryAddress.regionId','address.regionId'],
    keep: '(attribute_not_exists(#status) OR NOT (#status IN (:delivered, :completed, :cancelled, :canceled, :deliveredUpper, :completedUpper, :cancelledUpper, :canceledUpper)))',
    guards: {'#status':'status'},
    guardValues: {':delivered':'delivered',':completed':'completed',':cancelled':'cancelled',':canceled':'canceled',
      ':deliveredUpper':'DELIVERED',':completedUpper':'COMPLETED',':cancelledUpper':'CANCELLED',':canceledUpper':'CANCELED'},
  },
};

function createReferenceCheck({db,sdk,tables}) {
  async function containsReference(key, definition, ids) {
    if(!tables[key])throw Object.assign(Error('REGION_REFERENCE_CHECK_UNAVAILABLE'),{code:'REGION_REFERENCE_CHECK_UNAVAILABLE',status:503});
    const fields=(keys,prefix)=>keys.map((field,i)=>{
      const parts=field.split('.');
      const path=parts.map((_,j)=>`#${prefix}${i}_${j}`);
      return {path:path.join('.'), names:Object.fromEntries(path.map((name,j)=>[name,parts[j]]))};
    });
    const criteria=fields(definition.fields,'f');
    const paths=fields(definition.paths||[],'p');
    const names={...definition.guards,...Object.assign({},...criteria.concat(paths).map(field=>field.names))};
    for(let offset=0;offset<ids.length;offset+=20){
      const slice=ids.slice(offset,offset+20);
      const vars=slice.map((_,i)=>':r'+i);
      const clauses=criteria.map(field=>field.path+' IN ('+vars.join(', ')+')');
      for(const field of paths)for(const variable of vars)clauses.push('contains('+field.path+', '+variable+')');
      const filter='('+clauses.join(' OR ')+')'+(definition.keep?' AND '+definition.keep:'');
      let cursor;
      do{
        const page=await db.send(new sdk.ScanCommand({
          TableName:tables[key],ConsistentRead:true,Select:'COUNT',FilterExpression:filter,
          ExpressionAttributeNames:names,ExpressionAttributeValues:{...definition.guardValues,...Object.fromEntries(vars.map((v,i)=>[v,slice[i]]))},
          ...(cursor?{ExclusiveStartKey:cursor}:{}),
        }));
        if(page.Count>0)return true;
        cursor=page.LastEvaluatedKey;
      }while(cursor);
    }
    return false;
  }
  return async regionIds=>{
    const ids=[...new Set(regionIds)];
    if(!ids.length)return [];
    const results=await Promise.all(Object.entries(references).map(async ([key,definition])=>{
      if(!await containsReference(key,definition,ids))return null;
      return {code:'REGION_REFERENCES_EXIST',resource:key,message:'توجد ارتباطات في '+definition.label+'. انقل الارتباطات أو أغلقها قبل اعتماد التغيير.'};
    }));
    return results.filter(Boolean);
  };
}

module.exports={createReferenceCheck};
