'use strict';
function toNumber(value, fallback = 0) {
  if (value === null || value === undefined) return fallback;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : fallback;
}

// Normalize potentially mixed IQD/fils values to IQD.
function normalizeMoneyToIqd(rawAmount, referenceAmount = null) {
  const amount = toNumber(rawAmount, 0);
  if (amount <= 0) return 0;

  const reference = toNumber(referenceAmount, 0);
  if (reference > 0) {
    const ratio = amount / reference;
    if (ratio >= 900 && ratio <= 1100) {
      return amount / 1000;
    }
  }

  if (amount >= 100000 && amount % 1000 === 0) {
    return amount / 1000;
  }

  return amount;
}

function normalizeOrderPricingToIqd(order) {
  // This writer has a verified fixed scale. Never infer its unit from magnitude.
  if (order?.currency === 'IQD' && order?.createdBy === 'wizzuser_app' && order?.pricing) {
    return {
      goodsSubtotal: order.pricing.goodsSubtotal != null ? toNumber(order.pricing.goodsSubtotal) / 1000 : toNumber(order.subtotal),
      deliveryFee: order.pricing.deliveryFee != null ? toNumber(order.pricing.deliveryFee) / 1000 : toNumber(order.deliveryFee),
      tip: toNumber(order.pricing.tip) / 1000,
      total: order.pricing.total != null ? toNumber(order.pricing.total) / 1000 : toNumber(order.total ?? order.totalAmount),
    };
  }
  const rawOrderTotal = toNumber(order?.total ?? order?.totalAmount ?? 0, 0);

  const goodsSubtotal = normalizeMoneyToIqd(
    order?.pricing?.goodsSubtotal ?? order?.subtotal ?? 0,
    rawOrderTotal
  );
  const deliveryFee = normalizeMoneyToIqd(
    order?.pricing?.deliveryFee ?? order?.deliveryFee ?? 0,
    rawOrderTotal
  );
  const tip = normalizeMoneyToIqd(order?.pricing?.tip ?? 0, rawOrderTotal);

  let total = normalizeMoneyToIqd(order?.pricing?.total ?? rawOrderTotal, rawOrderTotal);
  if (total <= 0) {
    total = goodsSubtotal + deliveryFee + tip;
  }

  return {
    goodsSubtotal,
    deliveryFee,
    tip,
    total,
  };
}

const {financialOrderPricing}=require('./production-driver-trip-finance');
const first=(...values)=>values.find(v=>typeof v==='string'&&v.trim())?.trim()||'';
function pickupView(o){const a=o.storeAddress;return {restaurantId:first(o.storeId,o.restaurantId,o.businessId),restaurantName:first(o.storeName,o.restaurantName,o.businessName),restaurantAddress:first(o.restaurantAddress,o.pickupAddress,typeof a==='string'?a:'',a?.fullAddress,a?.detailedAddress,a?.addressLine1),restaurantPhone:first(o.restaurantPhone,o.businessPhone,o.storePhone)};}
const terminal=['delivered','completed','cancelled','canceled','returned'];
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const address=v=>typeof v==='string'?v: v?.fullAddress||v?.addressLine1||v?.address||v?.formattedAddress||'';
function tripView(o,normalizeOrderPricingToIqd,toNumber){
 const financial=['financialSnapshot','commercialPricing','financialAcceptance','financialOutcome','codFinancialEvidence'].some(k=>o[k]!=null);
 const done=['delivered','completed'].includes(o.status);
 let earning=null,base=null,tip=null,earningsState='UNAVAILABLE',cashRetained=null,walletCredit=null;
 if(financial && done && o.financialOutcome && o.walletFinancialStatus==='SETTLED'){
  try {const p=financialOrderPricing(o);if(p){earning=p.driverEarnings;base=p.driverEarning;tip=p.tip;earningsState='CONFIRMED';if(!o.cashAdjudication){cashRetained=p.driverCashRetained;walletCredit=p.laterWalletCredit;}}}catch{/* Do not substitute customer tariff for unavailable financial evidence. */}
 } else if(!financial && done && finite(o.driverEarnings) && o.driverEarnings>=0){earning=o.driverEarnings;earningsState='RECORDED';}
 const pricing=normalizeOrderPricingToIqd(o);
 const rawTotal=toNumber(o.total??o.totalAmount,0),pt=toNumber(o.pricing?.total,0);
 const scale=(o.currency==='IQD'&&o.createdBy==='wizzuser_app')||(rawTotal>0&&pt/rawTotal>=900&&pt/rawTotal<=1100)?1000:1;
 const customerFee=o.pricing?.deliveryFee!=null?toNumber(o.pricing.deliveryFee,0)/scale:pricing.deliveryFee;
 const pickup=pickupView(o),accepted=o.financialAcceptance?.acceptedAt||o.assignedAt||o.acceptedAt||null;
 const ended=o.deliveredAt||o.completedAt||o.returnedAt||o.cancelledAt||o.canceledAt||null;
 const duration=Date.parse(ended)-Date.parse(accepted);
 return {tripId:o.orderId||o.PK.replace('ORDER#',''),orderId:o.orderId||o.PK.replace('ORDER#',''),orderNumber:o.orderNumber||'',tripNumber:o.tripNumber||o.trip_number||null,
  status:done?'completed':o.status==='returned'?'returned':'cancelled',driverEarnings:earning,driverBaseEarnings:base,driverTip:tip,earningsState,
  // Compatibility fields are customer tariff only, never used as driver earnings by the new UI.
  deliveryFee:customerFee,finalDeliveryFee:earning,tip:tip??0,waveBonus:0,
  cashCollectedAmount:o.cashCollected===true&&finite(o.cashCollectedAmount)?o.cashCollectedAmount:null,
  driverCashRetained:cashRetained,driverWalletCredit:walletCredit,
  settledCollateral:done&&o.holdStatus==='SETTLED'&&finite(o.holdAmount)?o.holdAmount:null,
  paymentMethod:o.paymentMethod||null,holdStatus:o.holdStatus||null,
  pickupLocation:o.pickupLocation||o.restaurantLocation||{lat:o.restaurantLat??o.pickupLatitude??null,lng:o.restaurantLng??o.pickupLongitude??null},
  deliveryLocation:o.deliveryLocation||{lat:o.deliveryAddress?.lat??o.customerLat??o.deliveryLatitude??null,lng:o.deliveryAddress?.lng??o.customerLng??o.deliveryLongitude??null},
  pickupAddress:pickup.restaurantAddress||address(o.pickupAddress),deliveryAddress:address(o.deliveryAddress)||address(o.customerAddress),restaurantName:pickup.restaurantName||'',customerName:o.customerName||o.deliveryName||'',
  createdAt:o.createdAt,completedAt:ended,acceptedAt:accepted,pickupTime:o.pickedUpAt||o.pickupAt||null,deliveryTime:o.deliveredAt||null,
  estimatedDistanceMeters:finite(o.financialAcceptance?.calculation?.totalDistanceMeters)?o.financialAcceptance.calculation.totalDistanceMeters:null,
  durationSeconds:Number.isFinite(duration)&&duration>=0?Math.round(duration/1000):null,
  itemCount:Array.isArray(o.items)?o.items.length:null,quantity:Array.isArray(o.items)?o.items.reduce((sum,v)=>sum+(Number.isInteger(v.quantity)&&v.quantity>=0?v.quantity:0),0):null,
  deliveryProofCount:Array.isArray(o.deliveryProofs)?o.deliveryProofs.length:0,hasReturnCase:!!o.returnCaseId,
 };
}
function historyFilter(query,driverId){
 const states={completed:['delivered','completed'],cancelled:['cancelled','canceled'],returned:['returned']};
 if(query.status && !states[query.status])throw Error('INVALID_STATUS');
 const values={':driverId':driverId,':meta':'META'},names={'#status':'status'};
 const status=(states[query.status]||terminal).map((s,i)=>{values[':s'+i]=s;return ':s'+i;});
 let filter='driverId = :driverId AND SK = :meta AND #status IN ('+status.join(',')+')';
 if(query.from || query.to){
  const from=Date.parse(query.from),to=Date.parse(query.to);if(!Number.isFinite(from)||!Number.isFinite(to)||from>to)throw Error('INVALID_RANGE');
  values[':from']=new Date(from).toISOString();values[':to']=new Date(to).toISOString();values[':null']=null;
  const times=['deliveredAt','completedAt','returnedAt','cancelledAt','canceledAt','createdAt'];
  const absent=k=>`(attribute_not_exists(${k}) OR ${k} = :null)`;
  filter+=' AND ('+times.map((t,i)=>'('+[...times.slice(0,i).map(absent),`${t} BETWEEN :from AND :to`].join(' AND ')+')').join(' OR ')+')';
 }
 return {FilterExpression:filter,ExpressionAttributeNames:names,ExpressionAttributeValues:values};
}
module.exports={tripView,historyFilter,terminal};

// Cancellation awards are distinct from a delivery quote: use posted journal evidence.
async function tripWithSettlement(order,normalize,toNumber,read){
 const trip=tripView(order,normalize,toNumber);
 if(!['cancelled','returned'].includes(trip.status))return trip;
 trip.earningsState='COMPENSATION_CHECK_UNAVAILABLE';
 try{
  const [journal,review]=await Promise.all([read(trip.orderId,'EXCEPTION_ENTITLEMENTS'),read(trip.orderId,'CUSTOMER_CANCELLATION')]);
  if(review?.state==='CANCELLED'&&review.settlementStatus==='REVIEW')trip.earningsState='COMPENSATION_REVIEW';
  const amount=journal?.driverFareIqd;
  const lines=(journal?.walletLines||[]).filter(l=>l.walletId===`WALLET#DRIVER#${order.driverId}`);
  if(journal?.orderId===trip.orderId&&journal.driverId===order.driverId&&journal.kind==='ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL'&&journal.state==='POSTED'&&journal.settlementModel==='EXCEPTION_ACCRUAL_GL_V1'&&Number.isSafeInteger(amount)&&amount>=0&&review?.entitlementsPosted?.operationId===journal.operationId&&review.entitlementsPosted.driverFareIqd===amount&&lines.every(l=>l.balanceType==='AVAILABLE'&&l.unit==='IQD_WHOLE'&&Number.isSafeInteger(l.delta))&&lines.reduce((n,l)=>n+l.delta,0)===amount){
   trip.driverEarnings=amount;trip.driverBaseEarnings=amount;trip.driverWalletCredit=amount;trip.earningsState=amount?'COMPENSATION_PAID':'NO_COMPENSATION';
  }
 }catch{trip.earningsState='COMPENSATION_CHECK_UNAVAILABLE';}
 return trip;
}
module.exports.tripWithSettlement=(order,read)=>tripWithSettlement(order,normalizeOrderPricingToIqd,toNumber,read);
