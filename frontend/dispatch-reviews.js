(function(){'use strict';
const el=id=>document.getElementById('dispatch-review-'+id),path='/staff/dispatch-reviews';
const root=document.getElementById('dispatch-reviews');if(!root)return;
let busy=false,cursor=null,epoch=0,requests=new Map();
const labels={SEARCH_WINDOW_EXPIRED:'انتهت مهلة البحث',MAX_WAVES_REACHED:'انتهت الموجات المتاحة',PREPARATION_DEADLINE:'تعذر استكمال تجهيز الموجة',SEARCH_EXHAUSTED:'تعذر العثور على سائق',RESERVATION_PENDING:'نتيجة الحجز غير مؤكدة',ASSIGNMENT_PENDING:'الإسناد بانتظار تأكيد النتيجة',REVIEW_REQUIRED:'تحتاج مراجعة',OFFER_OR_AUTHORIZATION_CHANGED:'تغير العرض أو التفويض',RESERVATION_PROOF_CONFLICT:'تعارض دليل الحجز',UNEXPECTED_RESERVATION:'وجد حجز غير متوقع',BEFORE_PICKUP_RECORDED:'السجل قبل الاستلام',REQUIRES_CHECK:'حالة البضاعة تحتاج تحققًا',ACTIVE:'حجز السائق فعال',RELEASED:'حجز السائق مفكوك',CAPTURED:'حجز السائق مسوّى',NOT_RECORDED:'لا يوجد سجل حجز سائق',RETRY_SEARCH:'طلب إعادة البحث',CANCEL_BEFORE_PICKUP:'طلب إلغاء قبل الاستلام',CHECK_RESERVATION:'طلب تدقيق نتيجة الحجز'};
const errors={DISPATCH_REVIEW_DISABLED:'مراجعة الإسناد غير مفعلة بعد.',PERMISSION_REQUIRED:'لا تملك صلاحية هذه العملية.',EMPLOYEE_CHANGED:'تغيرت جلسة الموظف أو صلاحياته. أعد تحميل الصفحة.',REAUTH_REQUIRED:'أعد تسجيل الدخول قبل تسجيل القرار.',ENROLLMENT_REQUIRED:'أكمل التحقق الثنائي لحسابك.',REVIEW_CHANGED:'تغيرت الحالة. حدّث القائمة وراجعها قبل إرسال قرار جديد.',REVIEW_ALREADY_DECIDED:'سُجل طلب قرار لهذه الحالة. حدّث القائمة.',REVIEW_ACTION_NOT_ALLOWED:'هذه العملية غير متاحة للحالة الحالية؛ لا تتجاوز الحجز أو الاستلام.',REVIEW_INCOMPLETE:'تعذر استكمال قراءة أدلة الحالة. أعد المحاولة.',REVIEW_UNAVAILABLE:'الحالة لم تعد متاحة أو خارج نطاقك.'};
const decisionTitles={PENDING_EXECUTION:'طلب قرار مسجل — بانتظار التنفيذ المخوّل',EXECUTED:'تم إلغاء الطلب دون حجز أو تحرير أموال',STALE:'لم يُنفذ القرار — تغيرت الأدلة',AUTHORIZATION_CHANGED:'لم يُنفذ القرار — تغير تفويض الموظف',BLOCKED_DEPENDENCY:'القرار ينتظر استكمال اعتماد التنفيذ',NEEDS_REVIEW:'القرار يحتاج مراجعة الحجز والأدلة',SUPPRESSED_DELETION:'أُوقف القرار بسبب إغلاق المصدر أو حذف صاحبه'};
const resultLabels={BRANCH_UNAVAILABLE_FOR_SEARCH:'الفرع غير متاح لبدء البحث؛ راجع حالة التفعيل أو حظر المنصة.',RESPONSE_INTEGRATION_PENDING:'تنتظر إعادة البحث استكمال معالجة ردود العروض السابقة.',RETRY_EXECUTION_DISABLED:'تنفيذ إعادة البحث غير مفعل بعد.',SEARCH_RESTART_QUEUED:'حُفظت دورة بحث جديدة؛ بدء إرسال العروض بانتظار تأكيد المنفّذ، ولم تُحرر أموال.',CYCLE_NAMESPACE_REQUIRED:'إعادة البحث تنتظر عزل سجلات الدورة السابقة.',FINANCIAL_OR_SOURCE_WORKFLOW_REQUIRED:'هذه الحالة تحتاج مسارها المالي المثبت قبل الإلغاء.',GOODS_OR_RESERVATION_UNCONFIRMED:'حالة البضاعة أو الحجز غير محسومة.',ORDER_HAS_FINANCIAL_RECORDS:'توجد سجلات حجز أو تمويل تحتاج معالجة مستقلة.',RESERVATION_REQUIRES_RECONCILIATION:'نتيجة الحجز تحتاج مطابقة؛ لم يُحرر أي مبلغ.',SOURCE_CHANGED:'تغيرت الحالة قبل التنفيذ.',EMPLOYEE_AUTHORITY_CHANGED:'لم يعد تفويض الموظف مطابقًا للطلب.',SOURCE_UNAVAILABLE:'مصدر الحالة لم يعد متاحًا.',CANCELLED_WITHOUT_RESERVATION:'أُلغي الطلب قبل الاستلام بعد التحقق من خلوه من سجلات الحجز والتمويل.'};
Object.assign(resultLabels,{PRIOR_OFFER_STILL_ACTIVE:'بانتظار انتهاء صلاحية العروض السابقة قبل بدء دورة جديدة.',PRIOR_FINANCIAL_INTEGRATION_PENDING:'بانتظار اكتمال تسجيل فك الإسناد والضمان السابق؛ ستُعاد المحاولة تلقائيًا.',PRIOR_ACCEPTANCE_NOT_RELEASED:'يوجد قبول سابق لم يثبت فك إسناده وضمانه؛ يلزم تدقيقه أولًا.',PRIOR_GUARANTEE_RELEASE_PROOF_REQUIRED:'تعذر مطابقة الضمان مع سجل فك الإسناد؛ يلزم تدقيقه.',GOODS_ALREADY_HANDED_OVER:'سُجل تسليم الطلب للسائق؛ إعادة البحث قبل الاستلام غير متاحة.',RETRY_INVENTORY_REQUIRES_EXTENDED_REVIEW:'عدد المحاولات السابقة يحتاج مراجعة موسعة قبل إعادة البحث.'});
function renderDecision(box,d){const title=d.status==='EXECUTED'&&d.resultCode==='SEARCH_RESTART_QUEUED'?'سُجلت دورة بحث جديدة — بانتظار تأكيد التشغيل':d.status==='EXECUTED'&&d.resultCode!=='CANCELLED_WITHOUT_RESERVATION'?'نتيجة تحتاج تحققًا':decisionTitles[d.status]||'حالة قرار غير معروفة؛ حدّث البيانات.';box.append(text('strong',title),text('p',labels[d.action]||'طلب مراجعة'),text('p',d.reason||'لا يتوفر نص السبب.'),text('p','المرجع: '+d.requestId));if(d.resultCode)box.append(text('p',resultLabels[d.resultCode]||'راجع سجل القرار للتحقق من النتيجة.'));if(d.stale)box.append(text('p','تغيرت الأدلة بعد تسجيل الطلب؛ يحتاج المنفّذ إعادة التحقق.'));}
const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
function lock(on){busy=on;el('reload').disabled=on;el('more').disabled=on;for(const n of el('list').querySelectorAll('button,textarea,select'))n.disabled=on;}
async function api(suffix='',method='GET',body){await window.Auth.ensureSession();const base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL,token=window.Auth.getToken('accessToken');if(!base||!token)throw Error('تعذر تهيئة جلسة الموظف.');const response=await fetch(base+path+suffix,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(window.Auth.getToken('accessToken')!==token){epoch++;cursor=null;requests.clear();el('list').replaceChildren();el('more').hidden=true;el('message').textContent='تغيرت جلسة الموظف. حدّث القائمة من حسابك الحالي.';lock(false);throw Error('EMPLOYEE_CHANGED');}if(!response.ok)throw Error(errors[data.error]||'تعذر تنفيذ الطلب. لم تُؤكد نتيجته؛ أعد المحاولة بالمحتوى نفسه.');return data;}
function card(item){const box=document.createElement('article');box.style.cssText='border:1px solid #ddd;padding:16px;margin:12px 0';
 box.append(text('h3',(item.branchName||item.branchId)+' — '+item.orderId));
 for(const value of [labels[item.phase]||'حالة مراجعة',labels[item.reason]||'سبب يحتاج مراجعة',labels[item.goodsState]||'حالة البضاعة غير مؤكدة',labels[item.holdState]||'حالة الحجز غير مؤكدة'])box.append(text('p',value));
 if(item.attemptId)box.append(text('p','مرجع المحاولة: '+item.attemptId));
 if(item.pendingAcceptance)box.append(text('p','توجد محاولة قبول معلقة؛ إعادة البحث والإلغاء غير متاحين حتى تدقيقها.'));
 if(item.decision){renderDecision(box,item.decision);return box;}
 const choices=[['RETRY_SEARCH',item.canRequestRetry],['CANCEL_BEFORE_PICKUP',item.canRequestCancel],['CHECK_RESERVATION',item.canRequestReservationReview]].filter(x=>x[1]);
 if(!choices.length){box.append(text('p','الحالة للقراءة فقط أو تحتاج تحققًا إضافيًا قبل تسجيل قرار.'));return box;}
 box.append(text('p','إعادة البحث تفتح دورة جديدة لكل السائقين المؤهلين، بما فيهم من رفض العرض أو فُك إسناده سابقًا. تبقى شروط التوفر والمنطقة والضمان مطبقة، ويُحفظ سجل المحاولات السابقة.'));
 const select=document.createElement('select');select.setAttribute('aria-label','نوع طلب القرار');for(const [value]of choices){const option=text('option',labels[value]);option.value=value;select.append(option);}
 const reason=document.createElement('textarea');reason.placeholder='سبب طلب القرار (خمسة أحرف على الأقل)';reason.maxLength=1000;reason.setAttribute('aria-label','سبب طلب القرار');
 const button=text('button','تسجيل طلب القرار'),status=text('p','');button.type='button';box.append(select,reason,button,status);
 button.addEventListener('click',async()=>{if(busy)return;const message=reason.value.trim();if(message.length<5){status.textContent='اكتب سببًا واضحًا من خمسة أحرف على الأقل.';return;}
  const selector={orderId:item.orderId,source:item.source,...(item.attemptId?{attemptId:item.attemptId}:{})},payload={selector,action:select.value,baseDigest:item.baseDigest,reason:reason.value},fingerprint=JSON.stringify(payload),saved=requests.get(item.caseId);
  const request=saved?.fingerprint===fingerprint?saved:{fingerprint,requestId:crypto.randomUUID()};requests.set(item.caseId,request);const run=epoch;lock(true);status.textContent='جارٍ تسجيل الطلب…';
  try{const r=await api('/decisions','POST',{...payload,requestId:request.requestId});if(run!==epoch)return;if(r.status!=='PENDING_EXECUTION'){if(!decisionTitles[r.status]||r.executed!==(r.status==='EXECUTED'))throw Error('تعذر تأكيد حالة طلب القرار.');box.replaceChildren(text('h3',(item.branchName||item.branchId)+' — '+item.orderId));renderDecision(box,{...r,reason:reason.value});requests.delete(item.caseId);return;}if(r.executed!==false)throw Error('تعذر تأكيد حالة طلب القرار.');status.textContent='سُجل طلب القرار — بانتظار التنفيذ المخوّل. المرجع: '+r.requestId;box.replaceChildren(text('h3',(item.branchName||item.branchId)+' — '+item.orderId),text('strong',status.textContent),text('p','لم يُنفذ إلغاء أو تحرير أموال أو بدء بحث بهذه الخطوة.'));requests.delete(item.caseId);}
  catch(e){if(run===epoch)status.textContent=e.message;}
  finally{if(run===epoch)lock(false);}
 });return box;
}
async function load(more=false){if(busy)return;const run=++epoch;lock(true);el('message').textContent='جارٍ تحميل حالات المراجعة…';if(!more){cursor=null;el('list').replaceChildren();}el('more').hidden=true;
 try{const r=await api(cursor&&more?'?cursor='+encodeURIComponent(cursor):'');if(run!==epoch)return;for(const item of r.items||[])el('list').append(card(item));cursor=r.nextCursor||null;el('more').hidden=!cursor;el('message').textContent=el('list').children.length?'طلبات القرار لا تُعد تنفيذًا ماليًا أو إلغاءً.':cursor?'لا توجد حالات مطابقة في هذه الصفحة؛ يمكن متابعة القراءة.':'لا توجد حالات مراجعة متاحة ضمن نطاقك.';}
 catch(e){if(run===epoch){el('list').replaceChildren();cursor=null;el('more').hidden=true;el('message').textContent=e.message;}}
 finally{if(run===epoch)lock(false);}
}
async function openOrder(orderId){
 if(busy||typeof orderId!=='string'||!orderId)return;
 const run=++epoch;lock(true);cursor=null;el('more').hidden=true;el('list').replaceChildren();
 el('message').textContent='جارٍ تحميل مراجعة الطلب المحدد…';
 root.scrollIntoView({block:'start',behavior:'smooth'});
 try{const r=await api('?'+new URLSearchParams({orderId,source:'SEARCH'}));if(run!==epoch)return;if(!r.item||r.item.orderId!==orderId)throw Error('تعذر مطابقة مراجعة الطلب.');el('list').append(card(r.item));el('message').textContent=r.item.active?'هذه مراجعة الطلب المحدد؛ تسجيل القرار لا يعني تنفيذ إعادة البحث.':'لا توجد حالة تعثر نشطة لهذا الطلب؛ التفاصيل المعروضة للقراءة.';}
 catch(e){if(run===epoch)el('message').textContent=e.message;}
 finally{if(run===epoch)lock(false);}
}
window.DispatchReviewNavigation=Object.freeze({openOrder});
document.getElementById('orders-tbody')?.addEventListener('click',event=>{
 const button=event.target.closest('[data-review-order-id]');
 if(button)openOrder(button.dataset.reviewOrderId);
});
el('reload').addEventListener('click',()=>load());el('more').addEventListener('click',()=>load(true));
window.addEventListener('pagehide',()=>{epoch++;requests.clear();el('list').replaceChildren();});
load();
})();
