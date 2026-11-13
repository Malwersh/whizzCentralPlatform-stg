import {createHash} from 'node:crypto';
/** Operational receipt only. Never asserts a release, payment or liability decision. */
export function returnTaskNotice(order:Record<string,any>,offer:Record<string,any>,at:string):any[]{
 if(process.env.RETURN_TASK_NOTIFICATIONS_MODE!=='REQUIRED')return [];
 const table=process.env.WALLET_NOTIFICATIONS_TABLE;
 const valid=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(v);
 if(!table||![order.orderId,order.returnCaseId,order.driverId,offer.driverSubjectId,offer.branchId].every(valid)||order.driverId!==offer.driverId||order.orderId!==offer.orderId||!Number.isSafeInteger(order.assignmentAttemptCounter)||order.assignmentAttemptCounter<1||!Number.isFinite(Date.parse(at)))throw Error('RETURN_TASK_NOTICE_REFERENCE_INVALID');
 const eventId='RETURN_TASK_NOTICE#'+createHash('sha256').update(JSON.stringify([order.orderId,order.returnCaseId,order.assignmentAttemptCounter])).digest('hex');
 return [{Put:{TableName:table,Item:{eventId,type:'driver_return_task_updated',recipientApp:'driver',driverId:offer.driverSubjectId,financialDriverId:order.driverId,financialSubjectId:offer.driverSubjectId,branchId:offer.branchId,orderId:order.orderId,returnId:order.returnCaseId,title:'اكتملت مهمة إرجاع الأصناف',body:'تم توثيق تسليم الأصناف وانتهت مهمة الإرجاع. الضمان والمستحقات تخضع لمراجعة مستقلة؛ لا يعني هذا الإشعار تحرير الضمان أو صرف تعويض.',createdAt:at,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}}];
}
