'use strict';
const labels={pending:'بانتظار موافقة المطعم',confirmed:'أكد المطعم طلبك',preparing:'يجري تحضير طلبك',ready:'الطلب جاهز للاستلام',ready_for_pickup:'الطلب جاهز للاستلام',assigned:'تم تعيين سائق',heading_to_store:'السائق في طريقه إلى المطعم',arrived_at_store:'وصل السائق إلى المطعم',picked_up:'استلم السائق طلبك',heading_to_customer:'السائق في طريقه إليك',on_the_way:'السائق في طريقه إليك',arrived_at_customer:'وصل السائق إليك',delivered:'تم تسليم الطلب',cancelled:'ألغي الطلب',expired:'انتهت مهلة قبول المطعم',rejected:'رفض المطعم الطلب',returned:'أعيد الطلب'};
function content(order,now=Date.now()){
 const status=order.status,estimate=order.deliveryEstimate;
 const early=Date.parse(estimate?.earliestAt??order.estimatedDeliveryTime??''),late=Date.parse(estimate?.latestAt??order.estimatedDeliveryTime??'');
 let etaText=status==='pending'?'بانتظار موافقة المطعم':order.financialSearch?.status==='no_driver_available'?'بانتظار سائق':'يجري تقدير وقت الوصول';
 if(status!=='pending'&&order.financialSearch?.status!=='no_driver_available'&&Number.isFinite(late)){
  const time=t=>new Intl.DateTimeFormat('ar-IQ',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Baghdad'}).format(new Date(t));
  etaText=late<=now?'يجري تحديث وقت الوصول':Number.isFinite(early)&&early!==late?'وصول تقديري '+time(early)+'–'+time(late):'وصول تقديري '+time(late);
 }
 const progress={pending:0.08,confirmed:0.2,preparing:0.4,ready:0.55,ready_for_pickup:0.55,assigned:0.65,heading_to_store:0.65,arrived_at_store:0.7,picked_up:0.85,heading_to_customer:0.85,on_the_way:0.85,arrived_at_customer:0.95,delivered:1,cancelled:1,expired:1,rejected:1,returned:1};
 const arrival=status!=='pending'&&order.financialSearch?.status!=='no_driver_available'&&Number.isFinite(late)&&late>now?{arrivalEarliestEpoch:Math.floor((Number.isFinite(early)?early:late)/1000),arrivalLatestEpoch:Math.floor(late/1000)}:{};
 return {...arrival,status,statusLabel:labels[status]??'تحديث الطلب',storeName:order.storeName||'',orderNumber:order.orderNumber||order.orderId,etaText,progress:progress[status]??0};
}
module.exports={content};
