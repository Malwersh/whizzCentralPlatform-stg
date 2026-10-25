(() => {
'use strict';
const ordersTable=document.getElementById('orders-tbody')?.closest('table');if(ordersTable){const inbox=document.createElement('a');inbox.href='pickup-issues.html';inbox.textContent='بلاغات الاستلام المفتوحة';inbox.style.cssText='display:inline-block;margin:12px;padding:12px 18px;background:#082c63;color:white;border-radius:10px;text-decoration:none';ordersTable.before(inbox);}
let current=null,busy=false,epoch=0,pending=null;
const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
const dialog=document.createElement('dialog');dialog.dir='rtl';dialog.setAttribute('aria-label','إدارة الطلب');dialog.style.cssText='width:min(650px,90vw);max-height:85vh;overflow:auto;border:1px solid #dce4ef;border-radius:20px;padding:24px;color:#082c63';document.body.append(dialog);
const title=text('h2','إدارة الطلب'),content=document.createElement('div'),message=text('p',''),close=text('button','إغلاق');message.setAttribute('role','status');close.type='button';close.onclick=()=>{if(!busy){epoch++;dialog.close();}};dialog.append(title,content,message,close);
const errors={PERMISSION_REQUIRED:'لا تملك صلاحية هذا الإجراء.',ENROLLMENT_REQUIRED:'أكمل تهيئة حساب الموظف أولًا.',RECENT_AUTH_REQUIRED:'أعد تسجيل الدخول لتأكيد صلاحية الجلسة.',ORDER_CANCELLATION_PENDING:'يوجد طلب إلغاء قيد المراجعة؛ راجعه قبل تغيير الإسناد.',CANCELLATION_AFTER_PICKUP_OR_TERMINAL:'تغيّرت حالة الطلب أو استلمه السائق؛ حدّث البيانات.',COD_ASSIGNMENT_CONFLICT:'تغيّر إسناد الطلب؛ حدّث البيانات قبل إعادة المحاولة.',CANCELLATION_CONFLICT:'تغيّرت بيانات الإلغاء؛ راجع القضية المسجلة.',ORDER_MANAGEMENT_REASON_REQUIRED:'اكتب سببًا واضحًا من خمسة أحرف على الأقل.',EXCEPTION_PERMISSION_REQUIRED:'لا تملك صلاحية تنفيذ الإجراء.',ORDER_MANAGEMENT_DISABLED:'إدارة هذا المسار غير مفعلة حاليًا.'};
async function api(method,body){
 await window.Auth.ensureSession();const token=window.Auth.getToken('accessToken'),base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;if(!base||!token)throw Error('جلسة الموظف غير متاحة.');
 const r=await fetch(base+'/staff/order-management'+(method==='GET'?'?orderId='+encodeURIComponent(body.orderId):''),{method,cache:'no-store',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});const data=await r.json();
 if(token!==window.Auth.getToken('accessToken')){current=null;pending=null;content.replaceChildren();throw Error('تغير حساب الموظف. افتح إدارة الطلب مجددًا.');}
 if(!r.ok)throw Error(errors[data.error]||'تعذر تأكيد نتيجة الإجراء. حدّث البيانات؛ إذا أعدت المحاولة فستُستخدم هوية العملية نفسها.');return data;
}
function link(orderId){const a=text('a','متابعة قضايا الطلب والإلغاء');a.href='order-exceptions.html?orderId='+encodeURIComponent(orderId);return a;}
function button(label,fn){const b=text('button',label);b.type='button';b.style.cssText='padding:12px;margin:6px;border:1px solid #ccd8e8;border-radius:10px;background:#082c63;color:white;font:inherit';b.onclick=fn;return b;}
function render(item){
 current=item;title.textContent='إدارة الطلب '+item.orderNumber;content.replaceChildren();
 const labels={arrived_at_store:'وصل السائق إلى المطعم',ready_for_pickup:'جاهز للاستلام',assigned:'مسند إلى سائق',accepted:'قبله السائق',heading_to_store:'السائق في طريقه للمطعم',pending:'بانتظار المطعم',confirmed:'مؤكد',preparing:'قيد التحضير',picked_up:'استلمه السائق',out_for_delivery:'قيد التوصيل',delivered:'تم التسليم',cancelled:'ملغى'};
 content.append(text('p','الحالة: '+(labels[item.status]||item.status)),text('p',item.driverAssigned?'يوجد سائق مسند إلى الطلب':'لا يوجد سائق مسند حاليًا'));
 if(item.holdStatus==='ACTIVE')content.append(text('p','ضمان السائق المحجوز: '+Number(item.holdAmount).toLocaleString('ar-IQ')+' د.ع'));
 if(item.limitation)content.append(text('p',item.limitation));
 if(item.cancellation)content.append(text('p',item.cancellation.state==='REQUESTED'?'يوجد طلب إلغاء مسجل. تستطيع الإدارة حسمه الآن وفق حالة الاستلام.':'توجد قضية إلغاء مسجلة لهذا الطلب.'));
 const reason=document.createElement('textarea');reason.placeholder='سبب الإجراء الإداري';reason.setAttribute('aria-label','سبب الإجراء الإداري');reason.maxLength=500;reason.rows=3;reason.style.cssText='width:100%;box-sizing:border-box;font:inherit;padding:12px;border:1px solid #ccd8e8;border-radius:10px';
 if(item.canRequestCancellation||item.canUnassign)content.append(reason);
 if(item.canRequestCancellation)content.append(button('إلغاء الطلب بقرار الإدارة',()=>confirmAction('CANCEL_ORDER',reason.value,item)));
 if(item.canUnassign)content.append(button('فك إسناد السائق وإعادة البحث بالموجات',()=>confirmAction('UNASSIGN_REDISPATCH',reason.value,item)));
 if(item.merchantHandover?.state==='HANDED_TO_DRIVER')content.append(text('p','أكد المطعم تسليم الطلب للسائق؛ لا يُحرر الضمان باعتباره طلبًا لم يُستلم.'));
 if(item.status==='cancelled'&&item.cancellation){const a=text('a','تقييم وتعويض الإلغاء');a.href='cancellation-compensation.html?'+new URLSearchParams({orderId:item.orderId,caseKey:'CUSTOMER_CANCELLATION'});content.append(a,text('p','التعويض مستقل عن تحرير الضمان.'));}
 const pickupLink=text('a','بلاغات الاستلام ومتابعتها');pickupLink.href='pickup-issues.html?'+new URLSearchParams({orderId:item.orderId});content.append(pickupLink);
 if(Number.isSafeInteger(item.attempt)&&item.attempt>0){const quality=text('a','تسجيل حادث جودة أو سلامة');quality.href='driver-quality-review.html?'+new URLSearchParams({orderId:item.orderId,attempt:item.attempt});content.append(text('p',''),quality);}
 if(['delivered','completed'].includes(item.status)&&Number.isSafeInteger(item.attempt)){const review=text('a','مراجعة التأخير وأثره على أداء السائق');review.href='driver-timing-review.html?'+new URLSearchParams({orderId:item.orderId,attempt:item.attempt});content.append(text('p',''),review);}
 if(['delivered','completed'].includes(item.status)){const review=text('a','مراجعة تقييم السائق');review.href='driver-rating-review.html?'+new URLSearchParams({orderId:item.orderId});content.append(text('p',''),review);}
 content.append(button('تحديث الحالة',()=>open(item.orderId)),link(item.orderId));
}
async function confirmAction(action,reason,item){
 if(busy)return;if(reason.trim().length<5){message.textContent='اكتب سببًا واضحًا من خمسة أحرف على الأقل.';return;}
 const body={action,orderId:item.orderId,reason:reason.trim(),...(action==='UNASSIGN_REDISPATCH'?{offerId:item.offerId,attempt:item.attempt}:{})};const fingerprint=JSON.stringify(body);
 if(!window.confirm(action==='CANCEL_ORDER'?'تأكيد إلغاء الطلب بقرار الإدارة؟ لم يُسجّل استلام السائق أو تسليم المطعم. سيُحرر الضمان المؤهل ويُلغى التزام تمويل الخصم، وتبقى التعويضات للمراجعة المستقلة.':'فك إسناد السائق وإعادة الطلب للموجات؟ يُحرر حجز هذا السائق وتبقى فاتورة الزبون وتمويل الخصم محفوظين.'))return;
 if(pending?.fingerprint!==fingerprint)pending={fingerprint,idempotencyKey:crypto.randomUUID()};
 const run=epoch;busy=true;close.disabled=true;for(const b of content.querySelectorAll('button,textarea'))b.disabled=true;message.textContent='جارٍ تنفيذ الإجراء…';
 try{const r=await api('POST',{...body,idempotencyKey:pending.idempotencyKey});if(run!==epoch)return;pending=null;
  if(action==='CANCEL_ORDER')message.textContent=(r.cancelled||r.kind==='COD_CANCELLED'||r.cancellationStatus==='CANCELLED')?'تم إلغاء الطلب بقرار الإدارة. تابع القيود والحقوق المالية من القضية.':'لم يُؤكد تنفيذ الإلغاء؛ حدّث الحالة وراجع القضية.';
  else message.textContent='تم فك الإسناد وتحرير الحجز المؤهل. سُجلت إعادة الطلب للموجات؛ وصول عرض جديد يعتمد على توفر السائقين.';
  content.replaceChildren(link(item.orderId),button('تحديث حالة الطلب',()=>open(item.orderId)));
 }catch(e){if(run===epoch)message.textContent=e.message;}finally{busy=false;close.disabled=false;for(const b of content.querySelectorAll('button,textarea'))b.disabled=false;}
}
async function open(orderId){if(busy)return;const run=++epoch;current=null;content.replaceChildren();message.textContent='جارٍ قراءة الحالة والصلاحيات…';if(!dialog.open)dialog.showModal();busy=true;close.disabled=true;
 try{const r=await api('GET',{orderId});if(run!==epoch)return;render(r.item);message.textContent='';}catch(e){if(run===epoch)message.textContent=e.message;}finally{busy=false;close.disabled=false;}}
dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else epoch++;});
document.addEventListener('click',e=>{const b=e.target.closest('[data-manage-order-id]');if(b)open(b.dataset.manageOrderId);});
})();
