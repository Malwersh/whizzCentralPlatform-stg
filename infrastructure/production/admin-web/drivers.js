'use strict';
(()=>{
 const $=id=>document.getElementById(id),state={rows:[],cursor:null,selection:0,driver:null};
 const statuses={APPROVED:'معتمد',ACTIVE:'فعّال',PENDING:'بانتظار المراجعة',PENDING_REVIEW:'بانتظار المراجعة',REJECTED:'مرفوض',SUSPENDED:'معلّق',EXPIRED:'منتهي الصلاحية',REMOVED:'مزال',MISSING:'لم تُرفع',UNREVIEWED:'بانتظار المراجعة'};
 const label=value=>statuses[value]||'يحتاج مراجعة';
 const el=(tag,text,cls)=>{const x=document.createElement(tag);if(text!==undefined)x.textContent=text;if(cls)x.className=cls;return x;};
 async function api(path,body){
  await window.Auth.ensureSession();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const r=await fetch(path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body)}:{}),headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),...(body?{'Content-Type':'application/json'}:{})},cache:'no-store',signal:controller.signal});
   if(r.status===401){window.Auth.clearTokens();location.replace('/index.html');throw Error('انتهت الجلسة.');}
   if(r.status===403)throw Error('لا تتوفر صلاحية عرض هذه البيانات لحسابك.');
   if(r.status===404){const payload=await r.json().catch(()=>({}));throw Object.assign(Error('تعذّر العثور على السجل ضمن صلاحياتك.'),{code:payload.code||payload.error});}
   if(!r.ok){const payload=await r.json().catch(()=>({}));throw Object.assign(Error(body?'تعذر تأكيد القرار. حدّث الملف للتحقق من النتيجة.':'تعذر تحميل البيانات. أعد المحاولة.'),{code:payload.code||payload.error});}return await r.json();
  }catch(e){if(e.name==='AbortError')throw Error('تأخر الاتصال. أعد المحاولة.');throw e;}finally{clearTimeout(timer);}
 }
 function render(){
  const query=$('search').value.trim().toLocaleLowerCase(),rows=state.rows.filter(r=>(r.name+' '+r.phone).toLocaleLowerCase().includes(query));$('drivers').replaceChildren();
  for(const r of rows){const card=el('article',undefined,'driver-card');card.append(el('h2',r.name),el('p',[r.phone,r.governorate,r.region].filter(Boolean).join(' · ')),el('span',label(r.status),'status'));const b=el('button','فتح ملف السائق');b.onclick=()=>details(r,r.accountClosing?'account':'review');card.append(b);$('drivers').append(card);}
  if(!rows.length)$('drivers').append(el('p',query?'لا توجد نتائج مطابقة في البيانات المحمّلة.':state.cursor?'لا توجد حسابات ضمن صلاحياتك في هذه الدفعة. يمكنك تحميل المزيد.':'لا توجد حسابات سائقين في الإنتاج حتى الآن.'));
  $('more').hidden=!state.cursor;
 }
 async function load(more=false){$('retry').hidden=true;$('more').disabled=true;$('message').textContent='جارٍ تحميل حسابات السائقين…';
  try{if(!more){state.rows=[];state.cursor=null;}const data=await api('/staff/drivers'+(state.cursor?'?cursor='+encodeURIComponent(state.cursor):''));state.rows=[...state.rows,...data.items.filter(x=>!state.rows.some(r=>r.driverId===x.driverId))];state.cursor=data.nextCursor;$('directory').hidden=false;render();$('message').textContent='';}
  catch(e){$('message').textContent=e.message;$('retry').hidden=false;}finally{$('more').disabled=false;}
 }
 const deletionStatuses={READY:'جاهز للتنفيذ',PROCESSING:'جارٍ التنفيذ',COMPLETED:'اكتمل الحذف',
  CANCELLED:'أُلغي الطلب',RETRY_REQUIRED:'بانتظار إعادة المحاولة',PENDING_SETTLEMENT:'بانتظار التسوية',
  PENDING_EXTERNAL_ASSET:'بانتظار معالجة الملفات',PENDING_POLICY:'بانتظار مراجعة السياسة'};
 const deletionBlockers={ACTIVE_ORDERS:'طلبات قائمة',ACTIVE_HOLDS:'حجوزات مالية قائمة',
  LOCKED_BALANCE:'رصيد محجوز',REFUND_REQUIRED:'رصيد يحتاج إلى صرف',AMOUNT_DUE:'مبلغ مستحق للتحصيل',
  PENDING_PAYMENTS:'دفعات معلّقة',PENDING_TRANSFERS:'تحويلات معلّقة',
  DRIVER_SUPPORT_RETENTION_REVIEW_REQUIRED:'سجلات دعم تحتاج مراجعة الاحتفاظ',
  DRIVER_RATING_RETENTION_REVIEW_REQUIRED:'تقييمات تحتاج مراجعة الاحتفاظ',
  DOCUMENTED_RETENTION_HOLD:'سجلات خاضعة لاحتفاظ موثّق',
  QUALITY_CASE_REVIEW_REQUIRED:'سجلات مرتبطة تحتاج مراجعة',EXTERNAL_ASSET_ACCESS_REQUIRED:'ملفات تحتاج مراجعة الوصول'};
 function showDeletion(root,row,request){
  root.append(el('h3','طلب حذف الحساب'));
  if(request){
   const reference=el('bdi',request.requestId);
   const status=el('p',deletionStatuses[request.status]||'قيد المراجعة');
   const refLine=el('p','مرجع الطلب ');
   refLine.append(reference);
   root.append(status,refLine);
   if(Number.isFinite(request.updatedAt)){
    const format=new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
    root.append(el('p','آخر تحديث '+format.format(request.updatedAt<1e12?request.updatedAt*1000:request.updatedAt)));
   }
   if(request.blockers?.length){
    const list=el('ul');
    for(const code of request.blockers)list.append(el('li',deletionBlockers[code]||'عائق يحتاج مراجعة'));
    root.append(list);
   }
  }else root.append(el('p','لا يوجد طلب حذف لهذا الحساب.'));
  const refresh=el('button','تحديث حالة الطلب');
  refresh.type='button';
  refresh.onclick=()=>details(row,'account');
  root.append(refresh);
 }
 const integer=new Intl.NumberFormat('ar-IQ');
 const decimal=new Intl.NumberFormat('ar-IQ',{maximumFractionDigits:1});
 const percentage=new Intl.NumberFormat('ar-IQ',{style:'percent',maximumFractionDigits:1});
 function showPerformance(root,data){
  const statuses={CURRENT:'محدّث',UPDATING:'قيد التحديث',STALE:'بانتظار تحديث المصدر',UNAVAILABLE:'لا توجد مؤشرات محسوبة بعد'};
  const summary=el('div',undefined,'driver-performance-status');
  summary.append(el('h3','مؤشرات الأداء'),el('span',statuses[data.status]||statuses.UNAVAILABLE,'status'));
  root.append(summary);
  const date=Date.parse(data.computedAt);
  if(Number.isFinite(date)){
   const time=new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
   root.append(el('p','آخر حساب '+time.format(date),'driver-performance-time'));
  }
  if(data.status==='UNAVAILABLE')return;
  const metrics=el('dl',undefined,'driver-performance-stats');
  const number=(value,format)=>Number.isFinite(value)?format.format(value):'بيانات غير كافية';
  const sample=(value,unit)=>Number.isSafeInteger(value)&&value>=0?integer.format(value)+' '+unit:null;
  for(const [title,value,context] of [
   ['معدل قبول العروض',number(data.acceptanceRate,percentage),sample(data.acceptanceSample,'عرضًا محسوبًا')],
   ['معدل إكمال الرحلات',number(data.completionRate,percentage),sample(data.completionSample,'رحلة محسوبة')],
   ['الرفض المتتالي',number(data.consecutiveDeclines,integer),null],
   ['تقييم الزبائن',Number.isFinite(data.rating)?decimal.format(data.rating)+' من ٥':'بيانات غير كافية',sample(data.ratingCount,'تقييمًا')],
  ]){
   const metric=el('div');
   const description=el('dd',value);
   if(context)description.append(el('small',context));
   metric.append(el('dt',title),description);
   metrics.append(metric);
  }
  root.append(metrics);
 }
 async function details(row,view='review'){
  const selection=++state.selection;
  const isPerformance=view==='performance',isQuality=view==='quality',isAccount=view==='account';
  const root=$('driver-details'),message=$('detail-message');
  state.driver=row;
  $('detail').hidden=false;
  $('driver-name').textContent=row.name;
  $('review-view').setAttribute('aria-pressed',String(view==='review'));
  $('quality-view').setAttribute('aria-pressed',String(isQuality));
  $('performance-view').setAttribute('aria-pressed',String(isPerformance));
  $('account-view').setAttribute('aria-pressed',String(isAccount));
  root.replaceChildren();
  message.textContent=isAccount?'جارٍ تحميل طلب حذف الحساب…':isPerformance?'جارٍ تحميل أداء السائق…':'جارٍ تحميل الوثائق والمركبات…';
  $('detail').scrollIntoView({block:'start'});
  if(isQuality){
   message.textContent='';
   window.WizzDriverQuality.render({
    root,api,path:'/staff/drivers/'+encodeURIComponent(row.driverId)+'/quality',
    isCurrent:()=>selection===state.selection,
   });
   return;
  }
  try {
   const url='/staff/drivers/'+encodeURIComponent(row.driverId)+(isAccount?'/account-deletion':isPerformance?'/performance':'/vehicles');
   const data=await api(url);
   if(selection!==state.selection)return;
   message.textContent='';
   if(isAccount){showDeletion(root,row,data.request);return;}
   if(isPerformance){
    showPerformance(root,data);
    window.WizzDriverPerformanceReview.render({
     root,api,path:'/staff/drivers/'+encodeURIComponent(row.driverId)+'/quality',
     isCurrent:()=>selection===state.selection,
    });
    return;
   }
   const show=(current,action,decision)=>{
    if(selection!==state.selection)return;
    root.replaceChildren();
    if(current.profile?.status){
     state.rows=state.rows.map(item=>item.driverId===row.driverId?{...item,status:current.profile.status}:item);
     render();
    }
    if(action){
     message.textContent=action==='REVIEW_ACCOUNT'
      ?({APPROVED:'اعتمدت الإدارة حساب السائق.',SUSPENDED:'تم تعليق حساب السائق.',REJECTED:'تم تسجيل رفض اعتماد الحساب.'}[decision]||'تم تسجيل قرار الحساب.')
      :action==='INITIALIZE'?'سجل المركبات جاهز للمراجعة.':'تم حفظ قرار الوثيقة.';
     message.scrollIntoView({block:'nearest'});
    }
    window.WizzDriverReview.render({root,row,data:current,api,documentRow,isCurrent:()=>selection===state.selection,
     refresh:()=>details(row),onSaved:show});
   };
   show(data);
  }catch(error){
   if(selection!==state.selection)return;
   message.textContent=error.message;
   const retry=el('button','إعادة المحاولة');
   retry.type='button';retry.onclick=()=>details(row,view);
   root.append(retry);
  }
 }
 function documentRow(id,title,status,uploaded,query){const card=el('article',undefined,'driver-card');card.append(el('h3',title),el('span',label(status),'status'));if(!uploaded){card.append(el('p','لم تُرفع الوثيقة بعد.'));return card;}const button=el('button','تجهيز رابط الوثيقة');card.append(button);button.onclick=async()=>{button.disabled=true;try{const result=await api('/staff/drivers/'+encodeURIComponent(id)+'/documents/view?'+new URLSearchParams(query));const u=new URL(result.url);if(u.protocol!=='https:'||!u.hostname.endsWith('.amazonaws.com'))throw Error('تعذر فتح الوثيقة.');const link=el('a','فتح الوثيقة — رابط صالح لدقيقة','button');link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';button.replaceWith(link);setTimeout(()=>{link.removeAttribute('href');link.textContent='انتهت صلاحية الرابط. أعد فتح تفاصيل السائق.';},result.expiresIn*1000);}catch(e){const message=el('p',e.message);card.append(message);button.disabled=false;}};return card;}
 $('search').oninput=render;
 $('more').onclick=()=>load(true);
 $('retry').onclick=()=>load();
 $('review-view').onclick=()=>{if(state.driver)details(state.driver);};
 $('performance-view').onclick=()=>{if(state.driver)details(state.driver,'performance');};
 $('account-view').onclick=()=>{if(state.driver)details(state.driver,'account');};
 $('quality-view').onclick=()=>{if(state.driver)details(state.driver,'quality');};
 $('close').onclick=()=>{
  state.selection++;
  state.driver=null;
  $('detail').hidden=true;
  $('driver-details').replaceChildren();
 };
 load();
})();
