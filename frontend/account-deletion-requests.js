(function(){'use strict';
const el=id=>document.getElementById(id);let cursor=null,busy=false;
const statuses={COMPLETED:'اكتمل الحذف',CANCELLED:'أُلغي الطلب',READY:'جاهز للتنفيذ',PROCESSING:'جارٍ التنفيذ',RETRY_REQUIRED:'بانتظار إعادة المحاولة',PENDING_SETTLEMENT:'بانتظار التسوية',PENDING_POLICY:'بانتظار تجهيز التنفيذ',PENDING_EXTERNAL_ASSET:'بانتظار معالجة الملفات الخارجية'};
const actors={CUSTOMER:'المستخدم',DRIVER:'السائق',MERCHANT:'المطعم'};
const scopes={ACCOUNT:'الحساب الشخصي',BUSINESS:'إغلاق الفرع',MEMBERSHIP:'إزالة العضوية'};
const blockerTitles = {
 ACTIVE_ORDERS:'طلبات قائمة',
 PENDING_TRANSFERS:'تحويلات معلّقة',
 PENDING_PAYMENTS:'عمليات دفع أو شحن معلّقة',
 ACTIVE_HOLDS:'حجوزات مالية قائمة',
 LOCKED_BALANCE:'رصيد محجوز',
 REFUND_REQUIRED:'رصيد يحتاج صرفًا',
 AMOUNT_DUE:'مبلغ مستحق للتحصيل',
 OWNED_BUSINESSES:'فروع ما زالت باسم المالك',
 EXTERNAL_ASSET_ACCESS_REQUIRED:'وصول إلى ملفات قديمة',
 QUALITY_CASE_REVIEW_REQUIRED:'حالة تنتظر المراجعة',
 ADMIN_HANDOVER:'تسليم مسؤولية الإدارة',
};
const blockerSteps = {
 RESOLVE_ORDERS:'فريق التشغيل يراجع الطلبات ويكملها أو يغلقها عبر مسارها المعتمد.',
 FINISH_OR_REASSIGN:'فريق التوزيع يراجع المهام القائمة ويكملها أو يعيد إسنادها.',
 RESOLVE_TRANSFERS:'المراجع المالي يتتبع التحويل في سجل المحفظة ويستكمل تسويته أو إلغاءه بحسب حالته.',
 RESOLVE_PAYMENTS:'المراجع المالي يفتح العمليات المعلّقة ويكمل مراجعتها وتسويتها بحسب حالة كل عملية.',
 RESOLVE_ORDER_HOLDS:'المراجع المالي يطابق الحجز مع الطلب أو العملية المرتبطة به ويعالجها من مسار التسوية.',
 FINANCIAL_SETTLEMENT:'المراجع المالي يطابق المحفظة ثم يستكمل الصرف أو التحصيل عبر المسار المعتمد.',
 TRANSFER_OR_CLOSE_BUSINESSES:'مالك الحساب يفتح قائمة فروعه ويكمل إغلاق كل فرع أو نقل ملكيته.',
 VERIFY_LEGACY_STORAGE_ACCESS:'فريق تشغيل المنصة يتحقق من وصول خدمة الحذف إلى الملفات القديمة.',
 REVIEW_NONFINANCIAL_CASE_AND_RETENTION_POLICY:'فريق المراجعة يحسم الحالة وفق سياسة الاحتفاظ.',
 ASSIGN_SUCCESSOR:'إدارة المنصة تستكمل تعيين مسؤول بديل.',
};
function renderBlockers(cell, blockers) {
 if (!blockers.length) {
  cell.textContent = 'لا توجد موانع مسجلة';
  return;
 }
 const items = document.createElement('ul');
 for (const blocker of blockers) {
  const item = document.createElement('li');
  const title = document.createElement('strong');
  const amount = blocker.amount === undefined ? '' : ' — ' +
   new Intl.NumberFormat('ar-IQ').format(Math.abs(blocker.amount)) + ' د.ع.';
  const count = blocker.count === undefined ? '' : ' — العدد ' + blocker.count;
  title.textContent = (blockerTitles[blocker.code] || blocker.code) + amount + count;
  const step = document.createElement('div');
  step.textContent = blockerSteps[blocker.action] ||
   'أحِل مرجع الطلب ورمز المانع إلى فريق تشغيل المنصة.';
  item.append(title, step);
  items.append(item);
 }
 cell.append(items);
}
async function load(reset){if(busy)return;busy=true;el('reload').disabled=true;el('more').disabled=true;try{
try{await window.Auth.ensureSession();}catch(e){if(e.code==='SessionExpired')await window.Auth.logout();throw e;}
const base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL,token=window.Auth.getToken('accessToken');if(!base||!token)throw Error('يرجى تسجيل الدخول بحساب موظف مخول.');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;try{response=await fetch(base+'/staff/deletions/applications'+(!reset&&cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
const data=await response.json();if(response.status===401||data.error==='EMPLOYEE_INACTIVE'){await window.Auth.logout();throw Error('انتهت صلاحية الحساب.');}if(!response.ok)throw Error(['PERMISSION_REQUIRED','GLOBAL_SCOPE_REQUIRED'].includes(data.error)?'تحتاج صلاحية تدقيق أو مالية بنطاق جميع المناطق.':'تعذر تحميل الطلبات.');
if (reset) el('requests').replaceChildren();
for (const item of data.items) {
 const row = document.createElement('tr');
 const scope = item.scope?.kind || item.scope;
 row.insertCell().textContent = item.requestId;
 row.insertCell().textContent = (actors[item.actorType] || item.actorType) +
  ' / ' + (scopes[scope] || scope);
 row.insertCell().textContent = statuses[item.status] || item.status;
 renderBlockers(row.insertCell(), item.blockers || []);
 row.insertCell().textContent = item.updatedAt
  ? new Date(item.updatedAt).toLocaleString('ar-IQ') : '—';
 el('requests').append(row);
}
cursor=data.nextCursor;el('more').hidden=!cursor;el('message').textContent=cursor?'توجد صفحات أخرى؛ حمّل المزيد لإكمال الحصر.':el('requests').children.length?'اكتمل تحميل القائمة.':'لا توجد طلبات مسجلة.';
}catch(e){el('message').textContent=e.name==='AbortError'?'انقطع الاتصال. أعد التحديث؛ لا تتغير حالة الحذف بسبب فشل العرض.':e.message;}finally{busy=false;el('reload').disabled=false;el('more').disabled=false;}}
el('reload').onclick=()=>load(true);el('more').onclick=()=>load(false);load(true);
})();
