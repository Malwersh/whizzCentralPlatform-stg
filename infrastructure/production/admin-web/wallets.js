 'use strict';
(()=>{
const $=id=>document.getElementById(id), base='https://44rmfvjxp8.execute-api.us-east-1.amazonaws.com/production/wallet/funding/admin/';
let generation=0,selection=0,walletCursor=null,transactionCursor=null,walletId=null;
const money=n=>Number.isFinite(n)?new Intl.NumberFormat('ar-IQ').format(n)+' د.ع':'غير متاح';
const types={DRIVER:'سائق',CUSTOMER:'زبون',MERCHANT:'متجر',PLATFORM:'المنصة'};
let topupGeneration=0,topupCursor=null,topupBusy=false;
const topupStates={PENDING:'بانتظار المراجعة',APPROVED:'معتمد',POSTED:'تم الشحن',REJECTED:'مرفوض',CANCELED:'ملغى'};
async function topups(append=false){
 if(append&&topupBusy)return;
 const version=++topupGeneration,status=$('topup-status').value;
 topupBusy=true;$('topup-more').hidden=true;$('topup-refresh').disabled=true;
 $('topup-message').textContent='جارٍ تحميل طلبات الشحن…';
 if(!append){topupCursor=null;$('topups').replaceChildren();}
 try{
  const d=await read('../../topup/requests',{status,cursor:append?topupCursor:null});
  if(version!==topupGeneration)return;
  for(const t of d.requests||[]){
   const row=node('article','');row.className='driver-card';
   row.append(node('h3',topupStates[t.status]||'حالة غير معروفة'),node('strong',money(t.amountIQD)));
   const date=new Date(t.createdAt);if(!isNaN(date))row.append(node('p',date.toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})));
   const details=node('details','');details.append(node('summary','مراجع طلب الشحن'));
   for(const [label,value] of [['الطلب',t.topupId],['المحفظة',t.walletId],['مرجع التحويل',t.transferReference]])if(value)details.append(node('p',label+': '+value));
   row.append(details);
   if(/^receipts\/[a-zA-Z0-9-]+\/[a-f0-9-]+\.(jpg|png)$/.test(t.evidenceRef||'')){
    const button=node('button','عرض الوصل');button.type='button';button.onclick=()=>previewReceipt(t.evidenceRef);row.append(button);
   }
   if(t.status==='PENDING')for(const [action,label] of [['approve','اعتماد الشحن'],['reject','رفض الطلب']]){const b=node('button',label);b.type='button';b.onclick=()=>reviewTopup(t,action);row.append(b);}
   $('topups').append(row);
  }
  topupCursor=d.cursor||null;$('topup-more').hidden=!topupCursor;
  $('topup-message').textContent=$('topups').childElementCount?'التوقيت بتوقيت بغداد. اعتماد الشحن يضيف المبلغ للمحفظة بعد التحقق من الوصل.':'لا توجد طلبات شحن بهذه الحالة.';
 }catch(e){if(version===topupGeneration)$('topup-message').textContent=e.name==='AbortError'?'تأخر الاتصال. أعد المحاولة.':e.message;}
 finally{if(version===topupGeneration){topupBusy=false;$('topup-refresh').disabled=false;}}
}
function reviewTopup(t,action){
 const approve=action==='approve',dialog=document.createElement('dialog');
 dialog.dir='rtl';dialog.style.cssText='width:min(90vw,560px);border:1px solid #dce3ef;border-radius:24px;padding:24px;color:#062b68';
 const input=document.createElement('textarea'),result=node('p',''),confirm=node('button',approve?'تأكيد الاعتماد':'تأكيد الرفض'),cancel=node('button','رجوع');
 input.maxLength=1000;input.rows=3;input.placeholder=approve?'ملاحظة المراجعة (اختياري)':'سبب الرفض (مطلوب)';input.setAttribute('aria-label',input.placeholder);
 let busy=false;cancel.onclick=()=>dialog.close();dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});dialog.addEventListener('close',()=>dialog.remove());
 confirm.onclick=async()=>{
  if(busy)return;const reason=input.value.trim();if(!approve&&!reason){result.textContent='اكتب سبب الرفض.';input.focus();return;}
  busy=true;confirm.disabled=cancel.disabled=true;result.textContent='جارٍ تأكيد النتيجة…';
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   await window.Auth.ensureSession();const response=await fetch(new URL('../../topup/'+encodeURIComponent(t.topupId)+'/'+action,base),{method:'POST',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},body:JSON.stringify(approve?{note:reason}:{rejectionReason:reason}),cache:'no-store',signal:controller.signal});
   if(!response.ok)throw Error(response.status===409?'تغيرت حالة الطلب. أغلق النافذة وراجع القائمة.':response.status===403?'لا تملك صلاحية هذا القرار.':'تعذر تأكيد النتيجة. أغلق النافذة وراجع حالة الطلب قبل المحاولة.');
   dialog.close();await topups();$('topup-message').textContent=approve?'تم اعتماد الشحن بنجاح.':'تم رفض طلب الشحن.';wallets();
  }catch(e){result.textContent=e.name==='AbortError'?'تأخر الاتصال. أغلق النافذة وراجع حالة الطلب قبل المحاولة.':e.message;await topups();}
  finally{clearTimeout(timer);busy=false;cancel.disabled=false;}
 };
 dialog.append(node('h2',approve?'اعتماد الشحن':'رفض طلب الشحن'),node('p',approve?'سيُضاف '+money(t.amountIQD)+' إلى المحفظة. تحقق من وصول التحويل ومطابقة الوصل أولًا.':'لن يضاف أي رصيد لهذا الطلب.'),input,result,confirm,cancel);document.body.append(dialog);dialog.showModal();
}
let receiptVersion=0;
const receiptDialog=document.createElement('dialog');
receiptDialog.style.cssText='width:min(90vw,720px);border:1px solid #dce3ef;border-radius:24px;padding:24px;color:#062b68;';
const receiptClose=node('button','إغلاق'),receiptMessage=node('p',''),receiptImage=document.createElement('img');
receiptImage.alt='وصل طلب الشحن';receiptImage.style.cssText='display:block;max-width:100%;max-height:75vh;margin:auto;object-fit:contain';
receiptDialog.append(receiptClose,receiptMessage,receiptImage);document.body.append(receiptDialog);
receiptClose.onclick=()=>receiptDialog.close();
receiptDialog.addEventListener('close',()=>{receiptVersion++;receiptImage.removeAttribute('src');receiptMessage.textContent='';});
async function previewReceipt(key){
 const version=++receiptVersion;receiptImage.removeAttribute('src');receiptMessage.textContent='جارٍ تحميل الوصل…';
 if(!receiptDialog.open)receiptDialog.showModal();
 try{
  await window.Auth.ensureSession();const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  let response;try{response=await fetch(base+'receipt',{method:'POST',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},body:JSON.stringify({key}),cache:'no-store',signal:controller.signal});}finally{clearTimeout(timer);}
  if(!response.ok)throw Error('تعذر عرض الوصل. تحقق من صلاحيتك ثم أعد المحاولة.');
  const body=await response.json(),url=new URL((body.data||body).url);
  if(url.protocol!=='https:'||url.hostname!=='wizz-production-funding-receipts-746727375268-us-east-1.s3.us-east-1.amazonaws.com')throw Error('تعذر التحقق من رابط الوصل.');
  if(version!==receiptVersion||!receiptDialog.open)return;
  receiptImage.onload=()=>{if(version===receiptVersion)receiptMessage.textContent='';};
  receiptImage.onerror=()=>{if(version===receiptVersion)receiptMessage.textContent='تعذر تحميل صورة الوصل. أغلق المعاينة وأعد المحاولة.';};
  receiptImage.src=url.href;
 }catch(e){if(version===receiptVersion)receiptMessage.textContent=e.name==='AbortError'?'تأخر تحميل الوصل. أعد المحاولة.':e.message;}
}
async function read(route,params={}){
 await window.Auth.ensureSession(); const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{const u=new URL(base+route);for(const [k,v] of Object.entries(params))if(v)u.searchParams.set(k,v);
 const response=await fetch(u,{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')},signal:controller.signal,cache:'no-store'});
 if(!response.ok)throw Error(response.status===403?'لا تملك صلاحية عرض البيانات المالية.':response.status===401?'تعذر التحقق من جلسة الدخول. أعد تسجيل الدخول.':'تعذر تحميل البيانات. أعد المحاولة.');
 const body=await response.json();return body.data||body;
 }finally{clearTimeout(timer);}
}
function node(tag,text){const n=document.createElement(tag);n.textContent=text;return n;}
async function transactions(append=false){
 const version=++selection,id=walletId;$('transactions-more').hidden=true;$('transaction-message').textContent='جارٍ تحميل الحركات…';
 if(!append)$('transactions').replaceChildren();
 try{const d=await read('transactions',{walletId:id,cursor:append?transactionCursor:null});if(version!==selection)return;
 for(const t of d.transactions||[]){const row=node('article','');row.className='driver-card';row.append(node('p',t.description||'حركة مالية'),node('strong',money(t.amount)));const date=new Date(t.createdAt||t.timestamp);if(!isNaN(date))row.append(node('p',date.toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})));$('transactions').append(row);}
 transactionCursor=d.nextToken||d.lastEvaluatedKey||null;$('transactions-more').hidden=!transactionCursor;$('transaction-message').textContent=$('transactions').childElementCount?'التوقيت المعروض بتوقيت بغداد.':'لا توجد حركات مسجلة لهذه المحفظة.';
 }catch(e){if(version===selection)$('transaction-message').textContent=e.name==='AbortError'?'تأخر الاتصال. أعد المحاولة.':e.message;}
}
async function wallets(append=false){
 const version=++generation;$('more').hidden=true;$('refresh').disabled=true;$('message').textContent='جارٍ تحميل المحافظ…';
 if(!append){selection++;$('detail').hidden=true;$('wallets').replaceChildren();}
 try{const d=await read('wallets',{cursor:append?walletCursor:null});if(version!==generation)return;
 for(const w of d.wallets||[]){const row=node('article','');row.className='driver-card';row.append(node('h3',types[w.ownerType]||'محفظة'),node('p','المتاح: '+money(w.availableBalance)),node('p','المحجوز: '+money(w.lockedBalance)));const ref=node('details','');ref.append(node('summary','مرجع المحفظة'),node('p',w.walletId));row.append(ref);
 if(/^WALLET#(DRIVER#[a-f0-9-]{36}|PLATFORM)$/.test(w.walletId)){const b=node('button','عرض الحركات');b.onclick=()=>{walletId=w.walletId;$('selected').textContent=types[w.ownerType]||'محفظة';$('detail').hidden=false;transactions();$('detail').scrollIntoView({behavior:'smooth'});};row.append(b);}else row.append(node('p','تفاصيل حركات هذا النوع لم تُربط بعد.'));
 $('wallets').append(row);}
 walletCursor=d.nextCursor||null;$('more').hidden=!walletCursor;$('message').textContent=$('wallets').childElementCount?'الأرصدة حسب آخر قراءة؛ لا تمثل مطابقة مالية.':'لا توجد محافظ مسجلة بعد.';
 }catch(e){if(version===generation)$('message').textContent=e.name==='AbortError'?'تأخر الاتصال. أعد المحاولة.':e.message;}
 finally{if(version===generation)$('refresh').disabled=false;}
}
$('refresh').onclick=()=>wallets();$('more').onclick=()=>wallets(true);$('transactions-more').onclick=()=>transactions(true);$('close').onclick=()=>{selection++;$('detail').hidden=true;};
$('topup-refresh').onclick=()=>topups();$('topup-status').onchange=()=>topups();$('topup-more').onclick=()=>topups(true);

let fundingVersion=null,fundingBusy=false;
async function loadFunding(){
 if(fundingBusy)return;fundingBusy=true;$('funding-fields').disabled=true;$('funding-refresh').disabled=true;
 $('funding-message').textContent='جارٍ تحميل إعدادات الشحن…';
 try{const c=await read('../config');fundingVersion=c.version;
 $('funding-enabled').checked=c.manual?.enabled===true;$('funding-name').value=c.manual?.name||'';$('funding-phone').value=c.manual?.phone||'';
 $('funding-limits').textContent='حدود الشحن المعتمدة: '+money(c.manual?.minimum)+' إلى '+money(c.manual?.maximum);
 $('funding-fields').disabled=false;$('funding-message').textContent='';
 }catch(e){fundingVersion=null;$('funding-message').textContent='تعذر تحميل الإعدادات. أعد المحاولة.';}
 finally{fundingBusy=false;$('funding-refresh').disabled=false;}
}
$('funding-refresh').onclick=loadFunding;
$('funding-form').onsubmit=async event=>{
 event.preventDefault();if(fundingBusy||fundingVersion===null)return;
 const payload={version:fundingVersion,manual:{enabled:$('funding-enabled').checked,name:$('funding-name').value.trim(),phone:$('funding-phone').value.replace(/\s/g,'')}};
 fundingBusy=true;$('funding-fields').disabled=true;$('funding-refresh').disabled=true;
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
 try{await window.Auth.ensureSession();const response=await fetch(base+'config',{method:'PUT',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal,cache:'no-store'});
 if(response.status===409){fundingVersion=null;throw new Error('تغيرت الإعدادات أو تعذر تأكيد الحفظ. احتفظنا بمدخلاتك؛ حمّل الإعدادات للتحقق قبل إعادة الحفظ.');}
 if(!response.ok)throw new Error('تعذر تأكيد حفظ الإعدادات. حمّل الإعدادات للتحقق قبل إعادة المحاولة.');
 const body=await response.json(),saved=body.data||body;fundingVersion=saved.version;
 $('funding-message').textContent='تم حفظ إعدادات الشحن بنجاح.';
 }catch(e){fundingVersion=null;$('funding-message').textContent=e.name==='AbortError'?'تأخر تأكيد الحفظ. حمّل الإعدادات للتحقق من النتيجة قبل إعادة المحاولة.':e.message;}
 finally{clearTimeout(timer);fundingBusy=false;$('funding-refresh').disabled=false;$('funding-fields').disabled=fundingVersion===null;}
};
const transferLimits = [
 ['minAmount', 'الحد الأدنى للتحويل'],
 ['maxAmount', 'الحد الأعلى للتحويل'],
 ['driverDaily', 'الحد اليومي للسائق'],
 ['customerDaily', 'الحد اليومي للزبون'],
 ['merchantDaily', 'الحد اليومي للمتجر'],
 ['platformDaily', 'الحد اليومي للمنصة']
];
const walletLimits = [
 ['manualMinimumIqd', 'الحد الأدنى للشحن اليدوي'],
 ['manualMaximumIqd', 'الحد الأعلى للشحن اليدوي'],
 ['manualApprovalDailyIqd', 'الحد اليومي لاعتماد الشحن'],
 ['driverPayoutMaximumIqd', 'الحد الأعلى لصرف السائق']
];

function settingsSummary(title, config, fields) {
 const group = node('div', '');
 group.append(node('h3', title), node('p', config.version === 0 ? 'القيم الافتراضية' : 'الإعدادات المعتمدة'));
 const list = node('dl', '');
 list.className = 'wallet-limit-list';
 for (const [field, label] of fields) {
  const item = node('div', '');
  item.append(node('dt', label), node('dd', money(config[field])));
  list.append(item);
 }
 group.append(list);
 return group;
}

async function loadTransferSettings() {
 const refresh = $('transfer-settings-refresh');
 const message = $('transfer-settings-message');
 const results = $('transfer-settings-results');
 refresh.disabled = true;
 message.textContent = 'جارٍ تحميل الإعدادات…';
 results.replaceChildren();
 try {
  const [transfer, limits] = await Promise.all([
   read('transfer-settings'),
   read('transfer-settings', {view: 'wallet-operating-limits'})
  ]);
  const transferStatus = node('p', transfer.config.enabled ? 'إعداد التحويل مفعّل' : 'إعداد التحويل غير مفعّل');
  results.append(
   transferStatus,
   settingsSummary('حدود التحويل بين المحافظ', transfer.config, transferLimits),
   settingsSummary('حدود الشحن والصرف', limits.config, walletLimits)
  );
  message.textContent = '';
 } catch (error) {
  message.textContent = error.name === 'AbortError' ? 'تأخر تحميل الإعدادات. أعد المحاولة.' : error.message;
 } finally {
  refresh.disabled = false;
 }
}

$('transfer-settings-refresh').onclick = loadTransferSettings;
loadFunding();
wallets();topups();
})();
