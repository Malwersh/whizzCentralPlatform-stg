import { TopupRequest } from './types';
export function walletNotification(topup: TopupRequest, status: 'APPROVED' | 'REJECTED', timestamp: string) {
 const eventId = `${topup.topupId}#${status}`;
 return { Put: {
  TableName: process.env.WALLET_NOTIFICATIONS_TABLE!,
  Item: { eventId, driverId:topup.driverId, topupId:topup.topupId, amount:topup.amount, type:status==='APPROVED'?'wallet_topup_approved':'wallet_topup_rejected',
   title:status==='APPROVED'?'تم شحن محفظتك':'لم يُعتمد طلب الشحن',
   body:status==='APPROVED'?`أُضيف ${topup.amount.toLocaleString('en-US')} دينار إلى محفظتك.`:'افتح طلب الشحن للاطلاع على سبب الرفض.',
   createdAt:timestamp, deliveryStatus:'PENDING', nextAttemptAt:0, attempts:0 },
  ConditionExpression:'attribute_not_exists(eventId)'
 } };
}
