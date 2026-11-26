import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { checkoutTables } from './checkoutTables';
import { financialDispatchTables } from './walletBindings';
import { strongGet, FinancialRow as Row } from './driverFinancialTransaction';
import { quoteEntityIdValid } from './deliveryQuoteRecord';

const { financialOrderPricing } = require('../../../../whizzDrivers-stg/backend/financial-order-view');
const { pickupView } = require('../../../../whizzDrivers-stg/backend/driver-trip-route');

function view(order:Row,now:number) {
  const pricing=financialOrderPricing(order);
  if(!pricing) throw Error('FINANCIAL_ORDER_VIEW_UNAVAILABLE');
  const snapshot=order.financialSnapshot.order??order.financialSnapshot.snapshot??{};
  const address=order.deliveryAddress??order.customerAddress;
  return {
    orderId:order.orderId,orderNumber:order.orderNumber,status:order.status,
    ...pickupView(order),
    restaurantLat:order.restaurantLat??order.pickupLatitude??snapshot.branchPoint?.latitude,
    restaurantLng:order.restaurantLng??order.pickupLongitude??snapshot.branchPoint?.longitude,
    customerId:order.customerId??order.userId,customerName:order.customerName??order.deliveryName,
    customerPhone:order.customerPhone??order.userPhone,
    deliveryAddress:address,
    customerLat:order.customerLat??order.deliveryLatitude??snapshot.customerPoint?.latitude??address?.latitude??address?.lat,
    customerLng:order.customerLng??order.deliveryLongitude??snapshot.customerPoint?.longitude??address?.longitude??address?.lng,
    customerNearestLandmark:order.customerNearestLandmark??address?.landmark,
    total:pricing.total,totalAmount:pricing.total,pricing,paymentMethod:order.paymentMethod??'cash',
    items:order.items??[],specialInstructions:order.specialInstructions??order.notes,
    financialAssignment:{offerId:order.financialAcceptance.offerId,attempt:order.assignmentAttemptCounter,
      exceptionPolicyVersion:order.exceptionPolicy?.version,returnId:order.returnCaseId??null,
      returnStatus:order.returnStatus??null,serverNow:new Date(now).toISOString(),
      returnHandover:order.returnHandover??null,returnInstructions:order.returnInstructions??null},
    driverEarnings:pricing.driverEarnings,holdId:order.holdId,holdStatus:order.holdStatus,holdAmount:pricing.holdRequiredAmount,
    acceptedAt:order.acceptedAt??order.assignedAt,arrivedAtStoreAt:order.arrivedAtStoreAt,pickedUpAt:order.pickedUpAt,
    arrivedAtCustomerAt:order.arrivedAtCustomerAt,deliveredAt:order.deliveredAt,
  };
}

export function createProductionDriverActiveOrder({db,now=Date.now}:{
  db:Pick<DynamoDBDocumentClient,'send'>;now?:()=>number;
}) {
  const sources=checkoutTables(),dispatch=financialDispatchTables();
  return async (driverId:string,explicitOrderId?:string) => {
    const key={driverId};
    const lock={pk:'ACCOUNT_LIFECYCLE#DRIVER#'+driverId,sk:'META'};
    const [profile,closing,state]=await Promise.all([
      strongGet(db,dispatch.driver,key),strongGet(db,sources.deletion,lock),
      explicitOrderId===undefined?strongGet(db,dispatch.live,key):null,
    ]);
    if(!profile||profile.driverId!==driverId||closing||profile.deletionRequestId||profile.isDeleted||
        profile.deletedAt||profile.isBanned||profile.isSuspended) throw Error('UNAUTHORIZED');
    const orderId=explicitOrderId??state?.currentOrderId;
    if(orderId==null&&(state?.activeOrdersCount??0)===0) return {hasActiveOrder:false,order:null};
    if(!quoteEntityIdValid(orderId)) throw Error('ACTIVE_ASSIGNMENT_CHANGED');
    const order=await strongGet(db,sources.orders,{PK:'ORDER#'+orderId,SK:'META'});
    if(!order||order.orderId!==orderId||order.driverId!==driverId||
        (order.assignedDriverId!=null&&order.assignedDriverId!==driverId)||order.isDeleted||order.deletedAt||order.deletionRequestId) {
      throw Error(explicitOrderId===undefined?'ACTIVE_ASSIGNMENT_CHANGED':'ORDER_NOT_FOUND');
    }
    if(await strongGet(db,sources.deletion,lock)) throw Error('UNAUTHORIZED');
    if(explicitOrderId!==undefined) return view(order,now());
    const freshState=await strongGet(db,dispatch.live,key);
    if(freshState?.currentOrderId!==orderId) throw Error('ACTIVE_ASSIGNMENT_CHANGED');
    return {hasActiveOrder:true,order:view(order,now())};
  };
}
