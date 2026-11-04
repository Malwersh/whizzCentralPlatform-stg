const {parseIqd:m}=require('../../dist/money');
const at='2026-10-15T12:00:00.000Z',end='2026-10-15T12:02:00.000Z';
const driverPoint={latitude:31.91,longitude:44.45},branch={latitude:31.92,longitude:44.46},customer={latitude:31.93,longitude:44.47};
function route(id,origin,destination,distanceMeters=2000,durationSeconds=300){return {schemaVersion:1,origin,destination,profile:'driving',normalization:'CEIL_METERS_SECONDS_V1',route:{
 id,source:'MAPBOX_DIRECTIONS_V5',quality:'ROAD',fallbackPolicyId:null,distanceMeters,durationSeconds,measuredAt:at,expiresAt:end}};}
function input(earning='3000',method='COD'){
 const allocation={allocationSchemaVersion:1,paymentMethod:method,goodsGross:m('10000'),merchantGoodsDiscount:m('0'),platformGoodsDiscount:m('0'),merchantCommission:m('0'),
  serviceFee:m('500'),customerDeliveryFee:m('3000'),driverTip:m('1000'),merchantOtherCharges:m('0'),platformOtherCharges:m('0'),thirdPartyOtherCharges:m('0')};
 return {schemaVersion:1,offerId:'offer1',assignment:{id:'dispatch1',version:1,expiresAt:end},driver:{id:'driver1',subjectId:'driver-sub',vehicleType:'BIKE',positionVersion:1,
  point:driverPoint,observedAt:at,expiresAt:end},
 order:{snapshotId:'snapshot1',revision:1,orderId:'order1',branchId:'branch1',merchantId:'merchant1',zoneId:'zone1',cityId:'city1',governorateId:'gov1',
  branchPoint:branch,customerPoint:customer,confirmedCustomerTotal:m('14500'),allocation,
  paymentEvidence:method==='PREPAID'?{reference:'payment1',verifiedAt:at,amount:m('14500')}:null},
 policy:{version:1,rules:[{id:'rule1',version:1,scope:{type:'GLOBAL',id:'GLOBAL'},priority:1,status:'PUBLISHED',effectiveFrom:'2026-10-01T00:00:00.000Z',effectiveTo:null,
  rounding:'EXACT',vehicleType:null,base:m(earning),pickupPerKm:m('0'),pickupIncludedMeters:0,deliveryPerKm:m('0'),perMinute:m('0'),
  longDistance:{afterMeters:100000,flat:m('0'),perKm:m('0')},peaks:[],minimum:m('0'),maximum:m('10000'),fallbackPolicyId:null}]},
 pickupRoute:route('pickup',driverPoint,branch),deliveryRoute:route('delivery',branch,customer),at,ttlSeconds:60};
}

module.exports={at,end,driverPoint,branch,customer,route,input};
