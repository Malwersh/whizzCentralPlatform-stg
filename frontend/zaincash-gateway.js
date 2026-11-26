/* ZainCash operational settings. Secrets are write-only and never stored in browser storage. */
(function(){
'use strict';
const root=document.getElementById('zaincash-gateway');if(!root)return;
const base='https://z14s5f8oxh.execute-api.us-east-1.amazonaws.com/staging';
let config,profile,cursor=null,owners=[];const $=id=>root.querySelector('[data-zc="'+id+'"]');
async function fetchJson(url,options){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const r=await fetch(url,{...options,signal:controller.signal});return {r,d:await r.json()};}
 catch(_){throw Error('تعذر تأكيد نتيجة الاتصال. حدّث الإعدادات أو سجل العمليات قبل إعادة الإرسال.');}
 finally{clearTimeout(timer);}
}
async function call(path,method='GET',body){
 await window.Auth?.ensureSession?.();
 const token=window.Auth?.getToken?.('accessToken');if(!token)throw Error('سجّل الدخول مجددًا');
 const {r,d}=await fetchJson(base+'/wallet/funding/admin/zaincash'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw Error(d.error?.message||'تعذرت العملية. حدّث البيانات وتحقق من نتيجتها قبل التكرار.');return d.data||d;
}
root.innerHTML=`<h2>بوابة زين كاش لشحن محفظة السائق</h2>
<p>التحويل اليدوي ورفع الوصل مستقلان عن هذه البوابة. بيانات الاختبار لا تشحن الرصيد الفعلي. تُحفظ المفاتيح في مخزن أسرار الخادم ولا تُعرض مجددًا.</p>
<p data-zc="message" role="status" aria-live="polite"></p>
<button data-zc="load">تحديث إعدادات البوابة</button>
<div data-zc="form" hidden>
<label>بيئة البوابة<select data-zc="mode"><option value="UAT">اختبار UAT — رصيد تجريبي فقط</option><option value="LIVE">تشغيل فعلي — رصيد قابل للاستخدام</option></select></label>
<label>عنوان API الرسمي من الشركة<input data-zc="apiOrigin" type="url" dir="ltr" placeholder="https://pg-api-uat.zaincash.iq"></label>
<label>نطاقات صفحات الدفع الرسمية (نطاق في كل سطر، دون https://)<textarea data-zc="hosts" dir="ltr"></textarea></label>
<label>أقل مبلغ شحن د.ع<input data-zc="minimum" type="number" min="25000" max="500000"></label>
<label>أعلى مبلغ شحن د.ع<input data-zc="maximum" type="number" min="25000" max="500000"></label>
<details><summary>إدخال أو استبدال بيانات الشركة</summary><p>اترك الحقول فارغة للاحتفاظ بالبيانات الحالية. عند الاستبدال أدخل Client ID وClient Secret، ومفتاح API المطلوب للتشغيل الفعلي؛ تبقى العمليات القديمة مرتبطة بإعداداتها الأصلية.</p>
<label>معرّف الربط لدى زين كاش — Client ID<input data-zc="clientId" type="password" autocomplete="new-password" dir="ltr"></label>
<label>سر مصادقة الخادم — Client Secret<input data-zc="clientSecret" type="password" autocomplete="new-password" dir="ltr"></label>
<label>مفتاح التحقق من توقيع إشعارات الشركة — API Key (مطلوب للتشغيل الفعلي)<input data-zc="apiKey" type="password" autocomplete="new-password" dir="ltr"></label></details>
<label>السائقون المسموح لهم بتجربة الدفع الفعلي<select data-zc="pilotIds" multiple size="5"></select></label><p>اختر حتى ٥ سائقين. تظهر أسماؤهم وأرقام هواتفهم؛ تبقى بقية الحسابات ممنوعة من الدفع الفعلي حتى الاعتماد العام.</p><button data-zc="drivers">تحديث قائمة السائقين</button><p data-zc="driverMessage" role="status"></p><label><input data-zc="enabled" type="checkbox">السماح بإنشاء دفعات جديدة</label>
<button data-zc="import">تهيئة بيانات الاختبار المحفوظة دون عرض مفاتيحها</button><button data-zc="save">حفظ إعدادات البوابة</button><button data-zc="test">اختبار الاتصال بالشركة دون خصم مبلغ</button>
<p data-zc="readiness"></p><p>رابط إشعارات الشركة: <code data-zc="webhook"></code></p><p>صفحة العودة: <code data-zc="return"></code></p>
<details><summary>توثيق قبول التشغيل الفعلي</summary><p>هذا إقرار بالمراجعة الفعلية من الإدارة. اختبار الاتصال وحده لا يثبت اكتمال الدفع. يبدأ التشغيل بتجربة فعلية لحسابات محددة؛ يمنع الخادم التفعيل العام حتى يثبت نجاح دفع UAT ونجاح الدفع الفعلي ووصول إشعاره الموقّع.</p>
<label><input data-zc="fundingApproved" type="checkbox">وافقت شركة زين كاش على استخدام الحساب لشحن المحافظ</label>
<label><input data-zc="webhookRegistered" type="checkbox">سجّلت الشركة رابط الإشعارات وتم التحقق من تسليمه وتوقيعه</label>
<label><input data-zc="uatCompleted" type="checkbox">اكتمل اختبار الدفع والمطابقة وعدم تكرار الشحن وحالات الفشل</label>
<label>مرجع موافقة الشركة ونتائج الاختبار<textarea data-zc="evidence" maxlength="1000"></textarea></label><button data-zc="pilot">اعتماد تجربة فعلية للحسابات المحددة فقط</button><button data-zc="accept">تسجيل قبول التشغيل</button></details>
</div>
<h3>متابعة عمليات البوابة</h3><p>تتبع الخدمة العمليات تلقائيًا. نجاح رجوع المتصفح لا يثبت الدفع. لا توجد إضافة يدوية لرصيد عملية البوابة؛ يُستعلم من الشركة وتتم المطابقة أولًا.</p>
<label><input data-zc="reviewOnly" type="checkbox">الحالات التي تحتاج مراجعة فقط</label><button data-zc="payments">تحديث العمليات</button><div style="overflow:auto"><table><thead><tr><th>المرجع / السائق</th><th>المبلغ / البيئة</th><th>الحالة</th><th>المتابعة</th></tr></thead><tbody data-zc="rows"></tbody></table></div><button data-zc="more" hidden>تحميل عمليات أقدم</button>`;
async function run(action){for(const b of root.querySelectorAll('button'))b.disabled=true;try{await action();}catch(e){$('message').textContent=e.message;}finally{for(const b of root.querySelectorAll('button'))b.disabled=false;}}
function renderDrivers(selected){
 const select=$('pilotIds');select.replaceChildren();const all=new Map(owners.map(o=>[o.ownerId,o]));
 for(const id of selected)if(!all.has(id))all.set(id,{ownerId:id,name:'حساب تجربة محفوظ — بياناته غير متاحة حاليًا'});
 for(const [id,o]of all){const option=document.createElement('option');option.value=id;option.textContent=(o.name||'سائق مسجل')+(o.phone?' — '+o.phone:'');option.selected=selected.includes(id);select.append(option);}
}
async function loadDrivers(){
 const selected=$('pilotIds').options.length?[...$('pilotIds').selectedOptions].map(o=>o.value):(config.pilotDriverIds||[]);
 try{await window.Auth?.ensureSession?.();const {r,d}=await fetchJson(base+'/wallet/funding/admin/owners',{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')}});if(!r.ok)throw Error();owners=((d.data||d).owners||[]).filter(o=>!o.ownerType||o.ownerType==='DRIVER');renderDrivers(selected);$('driverMessage').textContent=owners.length?'اختر السائقين من القائمة للتجربة المحدودة.':'لا توجد حسابات سائقين في النتائج المتاحة.';}
 catch(_){renderDrivers(selected);$('driverMessage').textContent='تعذر تحميل أسماء السائقين. حُفظ الاختيار السابق؛ حدّث القائمة قبل تغيير حسابات التجربة.';}
}
$('drivers').onclick=()=>run(loadDrivers);
function render(){
 $('mode').value=config.mode;$('apiOrigin').value=config.apiOrigin||'https://pg-api-uat.zaincash.iq';$('hosts').value=(config.checkoutHosts||['pg-api-uat.zaincash.iq','pg-uat.zaincash.iq']).join('\n');$('minimum').value=config.minimum;$('maximum').value=config.maximum;$('enabled').checked=config.enabled;renderDrivers(config.pilotDriverIds||[]);
 $('readiness').textContent=`البيانات: ${config.credentialsConfigured?'محفوظة':'لم تُدخل'} — الاتصال: ${config.verifiedAt?'تم اختباره':'لم يُختبر'} — قبول التشغيل الفعلي: ${config.liveAcceptance?'موثّق':'غير موثّق'} — قبول التجربة الفعلية: ${config.pilotAuthorized?'موثّق':'غير موثّق'} — دفع UAT: ${config.uatPaymentVerified?'نجح':'لم يثبت بعد'} — إشعار فعلي موقّع: ${config.liveWebhookVerified?'وصل':'لم يثبت بعد'} — استقبال دفعات جديدة: ${config.enabled?'مفعّل':'متوقف'}`;
 $('webhook').textContent=config.webhookUrl||'يلزم تهيئة رابط الخدمة عند النشر';$('return').textContent=config.returnUrl||'يلزم تهيئة رابط العودة عند النشر';$('form').hidden=false;
 const can=profile?.permissions?.includes('finance.settings.request');for(const id of ['save','test','accept','import','pilot'])$(id).hidden=!can;
}
$('load').onclick=()=>run(async()=>{config=await call('');render();$('message').textContent='تم تحديث الإعدادات';});
$('save').onclick=()=>run(async()=>{
 const body={revision:config.revision,mode:$('mode').value,apiOrigin:$('apiOrigin').value.trim(),checkoutHosts:$('hosts').value.split(/\s+/).filter(Boolean),minimum:Number($('minimum').value),maximum:Number($('maximum').value),pilotDriverIds:[...$('pilotIds').selectedOptions].map(o=>o.value),enabled:$('enabled').checked};
 const credentials={};for(const id of ['clientId','clientSecret','apiKey'])credentials[id]=$(id).value;
 if(Object.values(credentials).some(Boolean))body.credentials=credentials;
 config=await call('','PUT',body);for(const id of Object.keys(credentials))$(id).value='';render();$('message').textContent='حُفظت الإعدادات. تغيير البيانات يتطلب اختبار الاتصال وقبول التشغيل مجددًا.';
});
$('import').onclick=()=>run(async()=>{config=await call('/import-uat','POST',{revision:config.revision});render();$('message').textContent='تم تهيئة بيانات UAT المحفوظة. اختبر الاتصال ثم فعّل الاختبار صراحة. لم تُفعّل دفعات حقيقية.';});
$('test').onclick=()=>run(async()=>{config=await call('/test','POST',{revision:config.revision});render();$('message').textContent='نجح اتصال المصادقة فقط. لم يُنشأ دفع ولم يُخصم مبلغ. استقبال الدفعات متوقف حتى تفعيله صراحة.';});
$('pilot').onclick=()=>run(async()=>{config=await call('/pilot','POST',{revision:config.revision,walletFundingApproved:$('fundingApproved').checked,evidence:$('evidence').value});render();$('message').textContent='اعتمدت تجربة التشغيل للحسابات المحددة. التفعيل التالي يتيح لها فقط الدفع الفعلي حتى نجاح الدفع ووصول إشعاره الموقّع واعتماد التفعيل العام.';});
$('accept').onclick=()=>run(async()=>{config=await call('/accept','POST',{revision:config.revision,walletFundingApproved:$('fundingApproved').checked,webhookRegistered:$('webhookRegistered').checked,uatCompleted:$('uatCompleted').checked,evidence:$('evidence').value});render();$('message').textContent='وُثّق القبول. فعّل استقبال الدفعات من الإعدادات عندما تقرر بدء التشغيل.';});
const states={CREATING:'إنشاء الدفع',CREATION_UNCERTAIN:'إنشاء غير مؤكد',PENDING:'بانتظار الدفع / التأكيد',SUCCESS:'نجح الدفع والتسوية',FAILED:'فشل',EXPIRED:'انتهت الصلاحية',CANCELED:'أُلغي',NOT_CREATED:'أكدت المراجعة عدم إنشاء الدفع',REVIEW_REQUIRED:'مراجعة مالية مطلوبة',REFUND_REVIEW_REQUIRED:'استرجاع يحتاج مراجعة مالية'};
async function payments(more=false){const data=await call('/payments?review='+$('reviewOnly').checked+(more&&cursor?'&cursor='+encodeURIComponent(cursor):''));cursor=data.cursor;$('more').hidden=!cursor;if(!more)$('rows').replaceChildren();for(const p of data.payments){const tr=document.createElement('tr');for(const text of [p.requestId+'\n'+p.driverId,p.amount+' د.ع — '+(p.mode==='UAT'?'تجريبي':'فعلي'),(states[p.state]||'غير معروف')+(p.reason?'\n'+p.reason:'')]){const td=document.createElement('td');td.textContent=text;tr.append(td);}const td=document.createElement('td');if(profile?.permissions?.includes('finance.settings.request')&&!['FAILED','EXPIRED','CANCELED'].includes(p.state)){const b=document.createElement('button');b.textContent=p.paymentId?'إعادة الاستعلام والمطابقة':'مطابقة معرّف العملية من الشركة';b.onclick=()=>run(async()=>{const paymentId=p.paymentId||prompt('معرّف Transaction ID من لوحة زين كاش لهذه العملية');if(!paymentId)return;const reason=prompt('سبب المراجعة ومصدر معرّف العملية');if(!reason)return;await call('/recover','POST',{driverId:p.driverId,requestId:p.requestId,paymentId,reason});await payments();$('message').textContent='تم الاستعلام. راجع حالة العملية؛ لا تُضف رصيدًا يدويًا مقابلها.';});td.append(b);if(!p.paymentId&&['CREATION_UNCERTAIN','REVIEW_REQUIRED'].includes(p.state)){const resolve=document.createElement('button');resolve.textContent='تسجيل تأكيد الشركة بعدم إنشاء الدفع';resolve.onclick=()=>run(async()=>{const evidence=prompt('مرجع تحقق الشركة الذي يؤكد عدم إنشاء الدفع وعدم تحصيل أي مبلغ. لا تستخدم هذا الإجراء لمجرد غياب الرد.');if(!evidence)return;if(!confirm('هل أكدت الشركة عدم إنشاء أو تحصيل هذه العملية؟ سيسمح للسائق ببدء دفعة جديدة.'))return;await call('/resolve-uncreated','POST',{driverId:p.driverId,requestId:p.requestId,providerConfirmedNoPayment:true,evidence});await payments();});td.append(resolve);}}tr.append(td);$('rows').append(tr);}}
$('reviewOnly').onchange=()=>run(()=>payments());
$('payments').onclick=()=>run(()=>payments());$('more').onclick=()=>run(()=>payments(true));
run(async()=>{const url=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;if(!url)throw Error('تعذر تحميل صلاحيات الإدارة');await window.Auth?.ensureSession?.();const {r,d}=await fetchJson(url+'/staff/me',{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')}});profile=d;if(!r.ok||!profile.permissions?.includes('finance.read'))throw Error('صلاحية مالية مطلوبة');config=await call('');render();const results=await Promise.allSettled([loadDrivers(),payments()]);for(const result of results)if(result.status==='rejected')throw result.reason;});
})();
