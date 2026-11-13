import {createHash} from 'node:crypto';
type Row=Record<string,any>;
/** Called only from a verified case transition; appended to that same transaction. */
export function exceptionFinancialNotices(c:Row,v:Row,receipt:Row):any[]{
 if(process.env.EXCEPTION_FINANCIAL_NOTIFICATIONS_MODE!=='REQUIRED')return [];
 const table=process.env.WALLET_NOTIFICATIONS_TABLE;
 const actions:Record<string,[boolean,string,string]>={
  APPROVE_EXCEPTION_ENTITLEMENTS:[false,'اعتُمد قرار المستحقات','اعتُمد قرار مستحقات محاولة التوصيل. لم يُنفّذ القيد المالي بعد، ولا يعني الاعتماد صرف المبلغ.'],
  EXECUTE_EXCEPTION_ENTITLEMENTS:[true,'نُفذ قرار المستحقات','نُفذ قرار مستحقات محاولة التوصيل. راجع حركة المحفظة لمعرفة ما قُيّد لك؛ لا يُعد هذا صرفًا نقديًا جديدًا.'],
  APPROVE_EXCEPTION_GUARANTEE:[false,'اعتُمد قرار ضمان الطلب','اعتُمد قرار ضمان الطلب. لم يُنفّذ تحرير أو تحميل الضمان بعد.'],
  EXECUTE_EXCEPTION_GUARANTEE:[true,'نُفذ قرار ضمان الطلب','نُفذ قرار ضمان الطلب. راجع حركة المحفظة وتفاصيل الضمان؛ هذا الإجراء لا يعني صرف أجرة أو تعويض.'],
  RELEASE_RETURN_GUARANTEE:[true,'تمت معالجة ضمان الطلب المرتجع','نُفذ قرار تحرير ضمان المرتجع، أو تأكد عدم وجود ضمان مطلوب. هذا الإجراء لا يدفع أجرة أو تعويضًا.']
 };
 const def=actions[v.action],valid=(x:unknown)=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(x);
 if(!table||!def||receipt.financialPosting!==def[0]||![v.orderId,v.caseId,v.idempotencyKey,c.subject,c.order?.driverId,c.offer?.branchId].every(valid)||c.order.orderId!==v.orderId||c.offer.orderId!==v.orderId||c.offer.driverId!==c.order.driverId||c.offer.driverSubjectId!==c.subject||receipt.orderId!==v.orderId||receipt.caseId!==v.caseId||receipt.action!==v.action)throw Error('EXCEPTION_FINANCIAL_NOTICE_INVALID');
 const make=(app:string,subject:string)=>{const eventId='EXCEPTION_FINANCIAL_NOTICE#'+createHash('sha256').update(JSON.stringify([v.orderId,v.caseId,v.idempotencyKey,v.action,app,subject])).digest('hex');return {Put:{TableName:table,Item:{eventId,type:app==='driver'?'driver_exception_financial_updated':'merchant_exception_financial_updated',recipientApp:app,driverId:subject,financialDriverId:c.order.driverId,financialSubjectId:c.subject,branchId:c.offer.branchId,orderId:v.orderId,caseId:v.caseId,caseAction:v.action,financialPosting:def[0],title:app==='driver'?def[1]:'تحديث على مستحقات متجرك',body:app==='driver'?def[2]:'افتح التطبيق للاطلاع على التفاصيل بعد التحقق.',createdAt:c.timestamp,deliveryStatus:'PENDING',nextAttemptAt:0,attempts:0},ConditionExpression:'attribute_not_exists(eventId)'}};};
 const ops=[make('driver',c.subject)];
 if(v.action.endsWith('ENTITLEMENTS')){if(!valid(c.branch?.ownerId)||c.branch.cognitoUserId!==c.branch.ownerId||c.branch.businessId!==c.offer.branchId)throw Error('EXCEPTION_FINANCIAL_NOTICE_OWNER_INVALID');ops.push(make('merchant',c.branch.ownerId));}
 return ops;
}
