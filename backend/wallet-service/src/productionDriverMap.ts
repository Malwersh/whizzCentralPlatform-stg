import { DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { FinancialRow as Row } from './driverFinancialTransaction';

type DB = Pick<DynamoDBDocumentClient, 'send'>;
type Point = {lat:number;lng:number};
const merchants = 'wizz-production-Merchants';
const neighborTable = 'wizz-production-RegionNeighbors';
const hours = 'wizz-production-WorkingHours';
const merchantProjection = [
  'businessId', 'businessName', 'businessType', 'category', 'regionId',
  'latitude', 'longitude', 'address', 'street', 'district', 'city', 'businessPhotoUrl',
  'acceptingOrders', 'isClosed', 'ordersBlocked', 'platformSuspended', 'isDeleted',
  'deletedAt', 'deletionRequestId',
];
const baghdad = new Intl.DateTimeFormat('en-US',{
  timeZone:'Asia/Baghdad',weekday:'long',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
});

function distance(a:Point,b:Point){
  const rad=Math.PI/180;
  const half=Math.sin((b.lat-a.lat)*rad/2)**2 +
    Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin((b.lng-a.lng)*rad/2)**2;
  return 12742*Math.asin(Math.min(1,Math.sqrt(half)));
}

function opensToday(schedule:Row|undefined,minute:number){
  if(!schedule) return true;
  if(schedule.isClosed===true) return false;
  const parse=(time:unknown)=>{
    if(typeof time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN;
    const [hour,minute]=time.split(':').map(Number);
    return hour*60+minute;
  };
  const start=parse(schedule.opening),end=parse(schedule.closing);
  if(!Number.isFinite(start)||!Number.isFinite(end)) return false;
  return start<=end ? minute>=start&&minute<end : minute>=start||minute<end;
}

export function createProductionDriverMap(db:DB,now=Date.now){
  let cache:{until:number;rows:Row[]}|undefined;
  let loading:Promise<Row[]>|undefined;
  async function readMerchants(){
    if(cache&&cache.until>now()) return cache.rows;
    loading??=(async()=>{
      const rows:Row[]=[];
      let cursor:Row|undefined;
      for(let page=0;page<50;page++){
        const reply=await db.send(new ScanCommand({
          TableName:merchants,
          FilterExpression:'#status = :approved AND #active = :active',
          ProjectionExpression:merchantProjection.map(attribute=>`#${attribute}`).join(','),
          ExpressionAttributeNames:{
            '#status':'status','#active':'isActive',
            ...Object.fromEntries(merchantProjection.map(attribute=>[`#${attribute}`,attribute])),
          },
          ExpressionAttributeValues:{':approved':'approved',':active':true},
          ExclusiveStartKey:cursor,
        }));
        rows.push(...(reply.Items??[]));
        cursor=reply.LastEvaluatedKey;
        if(!cursor){
          cache={until:now()+20000,rows};
          return rows;
        }
      }
      throw Error('INCOMPLETE_DRIVER_MAP');
    })().finally(()=>{loading=undefined;});
    return loading;
  }

  async function readNeighbors(regionId:string){
    const neighbors:Row[]=[];
    let cursor:Row|undefined;
    for(let page=0;page<10;page++){
      const result=await db.send(new QueryCommand({
        TableName:neighborTable,IndexName:'source-region-index',
        KeyConditionExpression:'source_region_id = :id',
        FilterExpression:'expansion_priority IN (:same,:near)',
        ExpressionAttributeValues:{':id':regionId,':same':0,':near':1},
        ExclusiveStartKey:cursor,
      }));
      neighbors.push(...(result.Items??[]));
      cursor=result.LastEvaluatedKey;
      if(!cursor) return neighbors;
    }
    throw Error('INCOMPLETE_DRIVER_MAP_NEIGHBORS');
  }

  return async (point:Point,regionId:string)=>{
    const [branches,neighbors]=await Promise.all([readMerchants(),readNeighbors(regionId)]);
    const regionPriorities=new Map(neighbors.map(n=>[n.target_region_id,n.expansion_priority]));
    regionPriorities.set(regionId,0);
    const baghdadTime=Object.fromEntries(baghdad.formatToParts(new Date(now())).map(p=>[p.type,p.value]));
    const minute=Number(baghdadTime.hour)*60+Number(baghdadTime.minute);
    const nearby=branches.flatMap(branch=>{
      if(!branch.businessId||!regionPriorities.has(branch.regionId)||branch.isDeleted||branch.deletedAt||
        branch.deletionRequestId||branch.platformSuspended) return [];
      const lat=branch.latitude??branch.address?.latitude,lng=branch.longitude??branch.address?.longitude;
      if(typeof lat!=='number'||!Number.isFinite(lat)||Math.abs(lat)>90||
         typeof lng!=='number'||!Number.isFinite(lng)||Math.abs(lng)>180) return [];
      const km=distance(point,{lat,lng});
      return km<=20?[{branch,lat,lng,km}]:[];
    }).sort((a,b)=>a.km-b.km).slice(0,100);
    const stores=await Promise.all(nearby.map(async ({branch,lat,lng,km})=>{
      const accepting=branch.acceptingOrders!==false&&!branch.ordersBlocked&&!branch.isClosed;
      const schedule=accepting?(await db.send(new GetCommand({
        TableName:hours,Key:{businessId:branch.businessId,weekday:baghdadTime.weekday},
      }))).Item:undefined;
      const open=accepting&&opensToday(schedule,minute);
      const address=branch.address;
      return {
        store_id:branch.businessId,name:branch.businessName??'',category:branch.businessType??branch.category??'restaurant',
        lat,lng,region_id:branch.regionId,distance_km:Number(km.toFixed(2)),
        address:typeof address==='string'?address:address?.fullAddress??
          [address?.street??branch.street,address?.district??branch.district,address?.city??branch.city].filter(Boolean).join('، '),
        photo_url:branch.businessPhotoUrl??null,accepting_orders:accepting,is_open:open,
        online_status:open?'online':accepting?'offline':'busy',
        expansion_priority:regionPriorities.get(branch.regionId),is_core_region:branch.regionId===regionId,
        is_hot:false,hot_score:0,waiting_orders_count:null,
      };
    }));
    return {
      neighbor_regions:neighbors.map(n=>({id:n.target_region_id,name:n.target_region_name??'',
        priority:n.expansion_priority,distance_km:Number(n.shared_boundary_km??0).toFixed(1)})),
      nearby_stores:stores,
      summary:{total_stores:stores.length,open_stores:stores.filter(s=>s.is_open).length,
        hot_stores:0,region_coverage_km:nearby.at(-1)?.km??0},
    };
  };
}
