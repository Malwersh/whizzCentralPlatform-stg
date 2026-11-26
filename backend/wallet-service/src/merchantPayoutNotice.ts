import {createHash} from 'node:crypto';
/** Append to the payout transition transaction: notification is not a second write. */
export function merchantPayoutNotice(row:any):any[]{
 if(process.env.MERCHANT_PAYOUT_NOTIFICATIONS_ENABLED!=='true')return [];
 if(process.env.MERCHANT_FINANCIAL_DEVICE_POLICY_ENABLED!=='true'||!process.env.WALLET_NOTIFICATIONS_TABLE)throw Error('PAYOUT_NOTIFICATION_CONFIGURATION_REQUIRED');
 if(!['AWAITING_RECEIPT','PAID','RECONCILIATION_REQUIRED','CANCELLED','FAILED_NOT_PAID'].includes(row.status))return [];
 if(!row.ownerId||!row.branchId||!/^MPO:[a-f0-9]{48}$/.test(row.payoutId)||!Number.isSafeInteger(row.version)||row.version<1)throw Error('PAYOUT_NOTIFICATION_REFERENCE_INVALID');
 const eventId='MERCHANT_PAYOUT_NOTICE#'+createHash('sha256').update(JSON.stringify([row.branchId,row.payoutId,row.version,row.status])).digest('hex');
 return [{Put:{TableName:process.env.WALLET_NOTIFICATIONS_TABLE,Item:{eventId,type:'merchant_payout_updated',recipientApp:'merchant',driverId:row.ownerId,branchId:row.branchId,payoutId:row.payoutId,payoutVersion:row.version,payoutStatus:row.status,title:'تحديث على مستحقات متجرك',body:'افتح التطبيق للاطلاع على التفاصيل بعد التحقق.',createdAt:row.updatedAt,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}}];
}
