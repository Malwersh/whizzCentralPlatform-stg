(function(){
'use strict';
const base='https://z14s5f8oxh.execute-api.us-east-1.amazonaws.com/staging';
let config;
let sandbox;
const el=id=>document.getElementById(id);
const message=text=>{el('message').textContent=text;};
async function call(path,method='GET',body){
 if(window.Auth?.ensureSession) await window.Auth.ensureSession();
 const token=window.Auth?.getToken?.('accessToken') || sessionStorage.getItem('accessToken') || localStorage.getItem('accessToken');
 if(!token)throw Error('يرجى تسجيل الدخول مجدداً');
 let r;
 try { r=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}); }
 catch (_) { throw Error('تعذر الاتصال بخدمة المحفظة. تحقق من الاتصال وأعد المحاولة.'); }
 const d=await r.json();
 if(r.status===401)throw Error('انتهت جلسة الدخول. سجّل الخروج ثم الدخول مجدداً.');
 if(r.status===403)throw Error('هذا القسم يتطلب صلاحية المدير المالي. إذا أُضيفت الصلاحية حديثاً، سجّل الخروج ثم الدخول لتحديث الجلسة.');
 if(!r.ok)throw Error(d.message || `تعذر الطلب (${r.status})`);
 return d.data || d;
}
function cell(row,text){const c=document.createElement('td');c.textContent=text;row.append(c);return c;}
function button(parent,label,action){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){message(e.message);}finally{b.disabled=false;}};parent.append(b);}
async function loadRequests(){
 const data=await call('/wallet/topup/requests?status='+el('status').value);
 el('requests').replaceChildren();
 for(const r of data.requests || []){
  const row=document.createElement('tr');
  cell(row,`${r.topupId}\n${r.driverId}`);cell(row,`${r.amount} د.ع`);
  const transfer=cell(row,`${r.transferReference || ''}\n${r.fundingSnapshot?.phone || ''}\n${r.fundingSnapshot?.name || ''}`);
  if(r.evidenceRef)button(transfer,'عرض الوصل',async()=>{const result=await call('/wallet/funding/admin/receipt','POST',{key:r.evidenceRef});const url=new URL(result.url);if(url.protocol!=='https:')throw Error('رابط غير صالح');window.open(url.href,'_blank','noopener');});
  cell(row,r.status+(r.rejectionReason?`\n${r.rejectionReason}`:''));
  const actions=cell(row,'');
  if(r.status==='PENDING'){
   button(actions,'اعتماد الشحن',async()=>{if(!confirm(`هل تحققت من وصول ${r.amount} د.ع ومرجع التحويل إلى الحساب المحدد؟`))return;await call(`/wallet/topup/${encodeURIComponent(r.topupId)}/approve`,'POST',{note:'تمت مطابقة التحويل في زين كاش'});message('تم اعتماد الشحن');await loadRequests();});
   button(actions,'رفض',async()=>{const reason=prompt('سبب الرفض');if(!reason?.trim())return;await call(`/wallet/topup/${encodeURIComponent(r.topupId)}/reject`,'POST',{rejectionReason:reason.trim()});await loadRequests();});
  }
  el('requests').append(row);
 }
}
async function init(){
 el('content').hidden=true;
 el('retry').hidden=true;
 message('جاري تحميل بيانات الشحن…');
 try{
  if(window.Auth?.requireAuthentication && !(await window.Auth.requireAuthentication()))return;
  if(window.navigationManager) await window.navigationManager.init();
  if(window.Auth?.ensureSession) await window.Auth.ensureSession();
  // The server enforces finance_manager; this read proves access before showing controls.
  await loadRequests();
  config=await call('/wallet/funding/config');
  el('phone').value=config.manual.phone;el('name').value=config.manual.name;el('enabled').checked=config.manual.enabled;
  try {
   sandbox=await call('/wallet/funding/admin/sandbox');
   el('sandbox-drivers').value=sandbox.driverIds.join('\n');
   el('sandbox-zaincash').checked=sandbox.zaincash;
   el('sandbox-qi').checked=sandbox.qi;
   fillSandboxAccounts();
   el('sandbox-section').hidden=false;
  } catch (_) { /* Sandbox controls remain hidden until the backend is available. */ }
  el('content').hidden=false;
  message('');
 }catch(e){message(e.message);el('retry').hidden=false;}
}
el('save').onclick=async()=>{el('save').disabled=true;try{config=await call('/wallet/funding/admin/config','PUT',{version:config.version,manual:{phone:el('phone').value,name:el('name').value,enabled:el('enabled').checked}});message('تم حفظ الإعدادات');}catch(e){message(e.message);}finally{el('save').disabled=false;}};
el('refresh').onclick=()=>loadRequests().catch(e=>message(e.message));
el('status').onchange=()=>loadRequests().catch(e=>message(e.message));
function fillSandboxAccounts(){
 const select=el('sandbox-account');select.replaceChildren();
 for(const id of sandbox.driverIds){const option=document.createElement('option');option.value=id;option.textContent=id;select.append(option);}
}
el('sandbox-load').onclick=async()=>{
 el('sandbox-load').disabled=true;
 try {
  const driver=el('sandbox-account').value;if(!driver)throw Error('حدد حساب اختبار أولاً');
  const data=await call('/wallet/funding/admin/sandbox?driverId='+encodeURIComponent(driver));
  el('sandbox-balance').textContent=`رصيد الاختبار فقط: ${data.balance} د.ع`;
  el('sandbox-payments').replaceChildren();
  for(const payment of data.payments){const row=document.createElement('tr');cell(row,`${payment.amount} د.ع`);cell(row,payment.provider);cell(row,payment.state);cell(row,payment.createdAt);el('sandbox-payments').append(row);}
 }catch(e){message(e.message);}finally{el('sandbox-load').disabled=false;}
};
el('sandbox-save').onclick=async()=>{
 el('sandbox-save').disabled=true;
 try {
  sandbox=await call('/wallet/funding/admin/sandbox','PUT',{version:sandbox.version,driverIds:el('sandbox-drivers').value.split(/\s+/).filter(Boolean),zaincash:el('sandbox-zaincash').checked,qi:el('sandbox-qi').checked});
  fillSandboxAccounts();
  message('تم حفظ إعدادات الاختبار؛ الرصيد الأساسي لا يتأثر.');
 } catch(e) { message(e.message); } finally { el('sandbox-save').disabled=false; }
};
let walletsCursor=null;
let owners=new Map();
let selectedWallet=null,ledgerCursor=null,ledgerGeneration=0;
const types={DRIVER:'سائق',PLATFORM:'المنصة',ACTIVE:'نشطة',SUSPENDED:'موقوفة',CLOSED:'مغلقة',HOLD_CREATED:'حجز مؤقت',HOLD_RELEASED:'فك الحجز',HOLD_CAPTURED:'تثبيت الحجز',TOPUP:'شحن',SETTLEMENT_RECEIVED:'تسوية واردة',CREDIT:'إضافة',DEBIT:'خصم'};
async function loadOwners(){
 if(!window.AWSUtils?.scanAll)return;
 const items=await window.AWSUtils.scanAll('WhizzDrivers_staging');
 owners=new Map(items.map(d=>[d.driverId,{name:d.name || d.fullName || 'اسم غير متوفر',phone:d.phoneNumber || d.phone || 'رقم غير متوفر'}]));
}
async function loadLedger(wallet,more=false){
 const generation=++ledgerGeneration;
 selectedWallet=wallet;el('ledger-section').hidden=false;
 el('ledger-owner').textContent=wallet.ownerType==='PLATFORM'?'محفظة المنصة':owners.get(wallet.ownerId)?.name || wallet.ownerId;
 el('ledger-message').textContent='جاري تحميل الحركات…';el('ledger-more').disabled=true;
 try{
  const data=await call('/wallet/funding/admin/transactions?walletId='+encodeURIComponent(wallet.walletId)+(more && ledgerCursor?'&cursor='+encodeURIComponent(ledgerCursor):''));
  if(generation!==ledgerGeneration)return;
  if(!more)el('ledger').replaceChildren();
  for(const entry of data.transactions){
   const row=document.createElement('tr');
   cell(row,entry.createdAt || entry.timestamp || '—');cell(row,types[entry.category || entry.type] || entry.category || entry.type);
   cell(row,`${entry.amount} د.ع`);cell(row,entry.description || '—');cell(row,entry.relatedEntityId || entry.transactionId || entry.txnId || '—');el('ledger').append(row);
  }
  ledgerCursor=data.nextToken;el('ledger-more').hidden=!ledgerCursor;el('ledger-message').textContent=el('ledger').children.length?'':'لا توجد حركات مسجلة لهذه المحفظة.';
 }catch(e){if(generation===ledgerGeneration)el('ledger-message').textContent=e.message;}
 finally{if(generation===ledgerGeneration)el('ledger-more').disabled=false;}
}
el('ledger-more').onclick=()=>selectedWallet && loadLedger(selectedWallet,true);

async function loadWallets(more=false){
 el('wallets-load').disabled=true;el('wallets-more').disabled=true;
 el('wallets-message').textContent='جاري تحميل المحافظ…';
 try{
  if(!more)await loadOwners();
  const data=await call('/wallet/funding/admin/wallets'+(more && walletsCursor?'?cursor='+encodeURIComponent(walletsCursor):''));
  if(!more)el('wallets').replaceChildren();
  for(const wallet of data.wallets){
   const row=document.createElement('tr');
   const owner=owners.get(wallet.ownerId);
   const ownerCell=cell(row,wallet.ownerType==='PLATFORM'?'محفظة المنصة':`${owner?.name || 'اسم غير متوفر'}\n${owner?.phone || 'رقم غير متوفر'}`);
   ownerCell.title=wallet.walletId;
   cell(row,types[wallet.ownerType] || wallet.ownerType);cell(row,types[wallet.status] || wallet.status);
   cell(row,`${wallet.availableBalance.toLocaleString('ar-IQ')} د.ع`);
   cell(row,`${wallet.lockedBalance.toLocaleString('ar-IQ')} د.ع`);
   cell(row,wallet.updatedAt?new Date(wallet.updatedAt).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'}):'—');
   button(cell(row,''),'عرض الحركات',()=>loadLedger(wallet));
   el('wallets').append(row);
  }
  walletsCursor=data.nextCursor;el('wallets-more').hidden=!walletsCursor;
  el('wallets-message').textContent='تم تحميل الصفحة. استخدم تحميل المزيد لاستكمال القائمة إن ظهر.';
 }catch(e){el('wallets-message').textContent=e.message;}
 finally{el('wallets-load').disabled=false;el('wallets-more').disabled=false;}
}
el('wallets-load').onclick=()=>loadWallets();
el('wallets-more').onclick=()=>loadWallets(true);
el('retry').onclick=init;
init();
})();
