(function(){'use strict';
const el=id=>document.getElementById(id);let cursor=null,busy=false;
const statuses={COMPLETED:'اكتمل الحذف',READY:'جاهز للتنفيذ',PROCESSING:'جارٍ التنفيذ',RETRY_REQUIRED:'بانتظار إعادة المحاولة',PENDING_SETTLEMENT:'بانتظار التسوية',PENDING_POLICY:'بانتظار تجهيز التنفيذ',PENDING_EXTERNAL_ASSET:'بانتظار معالجة الملفات الخارجية'};
const actors={CUSTOMER:'المستخدم',DRIVER:'السائق',MERCHANT:'المطعم'};
const scopes={ACCOUNT:'الحساب الشخصي',BUSINESS:'إغلاق المطعم',MEMBERSHIP:'إزالة العضوية'};
async function load(reset){if(busy)return;busy=true;el('reload').disabled=true;el('more').disabled=true;try{
try{await window.Auth.ensureSession();}catch(e){if(e.code==='SessionExpired')await window.Auth.logout();throw e;}
const base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL,token=window.Auth.getToken('accessToken');if(!base||!token)throw Error('يرجى تسجيل الدخول بحساب موظف مخول.');
const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);let response;try{response=await fetch(base+'/staff/deletions/applications'+(!reset&&cursor?'?cursor='+encodeURIComponent(cursor):''),{headers:{Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timer);}
const data=await response.json();if(response.status===401||data.error==='EMPLOYEE_INACTIVE'){await window.Auth.logout();throw Error('انتهت صلاحية الحساب.');}if(!response.ok)throw Error(['PERMISSION_REQUIRED','GLOBAL_SCOPE_REQUIRED'].includes(data.error)?'تحتاج صلاحية تدقيق أو مالية بنطاق جميع المناطق.':'تعذر تحميل الطلبات.');
if(reset)el('requests').replaceChildren();for(const item of data.items){const row=document.createElement('tr');const details=(item.blockers||[]).map(b=>b.code+(b.count!==undefined?' — العدد '+b.count:'')+(b.amount!==undefined?' — الرصيد '+b.amount+' د.ع.':'')).join('؛ ')||'لا توجد موانع مسجلة';for(const value of [item.requestId,(actors[item.actorType]||item.actorType)+' / '+(scopes[item.scope?.kind]||item.scope?.kind||scopes[item.scope]||item.scope),statuses[item.status]||item.status,details,item.updatedAt?new Date(item.updatedAt).toLocaleString('ar-IQ'):'—']){const td=document.createElement('td');td.textContent=value;row.append(td);}el('requests').append(row);}
cursor=data.nextCursor;el('more').hidden=!cursor;el('message').textContent=cursor?'توجد صفحات أخرى؛ حمّل المزيد لإكمال الحصر.':el('requests').children.length?'اكتمل تحميل القائمة.':'لا توجد طلبات مسجلة.';
}catch(e){el('message').textContent=e.name==='AbortError'?'انقطع الاتصال. أعد التحديث؛ لا تتغير حالة الحذف بسبب فشل العرض.':e.message;}finally{busy=false;el('reload').disabled=false;el('more').disabled=false;}}
el('reload').onclick=()=>load(true);el('more').onclick=()=>load(false);load(true);
})();
