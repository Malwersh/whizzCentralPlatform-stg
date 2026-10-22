(function(){
'use strict';
const base='https://z14s5f8oxh.execute-api.us-east-1.amazonaws.com/staging';
let config,staffProfile=null;
const can=permission=>staffProfile?.permissions?.includes(permission)||permission==='bootstrap.only'&&staffProfile?.employee?.roles?.includes('bootstrap_admin');
async function staffAccess(){const url=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;if(!url)throw Error('تعذر تحميل صلاحيات الموظف. أعد تسجيل الدخول.');const response=await fetch(url+'/staff/me',{headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')}});staffProfile=await response.json();if(!response.ok||!can('finance.read'))throw Error('صلاحية مالية مطلوبة. تحقق من الحساب وأعد تسجيل الدخول.');for(const [id,permission] of Object.entries({'transfer-create':'finance.request','transfer-settings-propose':'finance.settings.request','save':'bootstrap.only','sandbox-save':'bootstrap.only'}))el(id).hidden=!can(permission);}
let sandbox;
let transferPolicy=null,settingsPending=null;
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
 if(r.status===403 && ['REAUTH_REQUIRED','SECOND_APPROVER_REQUIRED'].includes(d.error?.code))throw Error(d.error.message);
 if(r.status===403)throw Error('هذا القسم يتطلب صلاحية المدير المالي. إذا أُضيفت الصلاحية حديثاً، سجّل الخروج ثم الدخول لتحديث الجلسة.');
 if(!r.ok)throw Error(d.error?.message || d.message || `تعذر الطلب (${r.status})`);
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
   if(can('finance.approve'))button(actions,'اعتماد الشحن',async()=>{if(!confirm(`هل تحققت من وصول ${r.amount} د.ع ومرجع التحويل إلى الحساب المحدد؟`))return;await call(`/wallet/topup/${encodeURIComponent(r.topupId)}/approve`,'POST',{note:'تمت مطابقة التحويل في زين كاش'});message('تم اعتماد الشحن');await loadRequests();});
   if(can('finance.topup.review'))button(actions,'رفض',async()=>{const reason=prompt('سبب الرفض');if(!reason?.trim())return;await call(`/wallet/topup/${encodeURIComponent(r.topupId)}/reject`,'POST',{rejectionReason:reason.trim()});await loadRequests();});
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
  await staffAccess();await loadRequests();
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
  await loadRecipients();
  await loadTransferSettings();
  await loadLifecycle();
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
const types={DRIVER:'سائق',CUSTOMER:'مستخدم',MERCHANT:'مطعم',PLATFORM:'المنصة',ACTIVE:'نشطة',SUSPENDED:'موقوفة',CLOSED:'مغلقة',HOLD_CREATED:'حجز مؤقت',HOLD_RELEASED:'فك الحجز',HOLD_CAPTURED:'تثبيت الحجز',TOPUP:'شحن',SETTLEMENT_RECEIVED:'تسوية واردة',CREDIT:'إضافة',DEBIT:'خصم'};
async function loadOwners(){
 const data=await call('/wallet/funding/admin/owners');
 owners=new Map((data.owners||[]).map(d=>[d.ownerId,{name:d.name || 'اسم غير متوفر',phone:d.phone || 'رقم غير متوفر'}]));
}
let recipientsLoading=false;
async function loadRecipients(){
 if(recipientsLoading)return;
 recipientsLoading=true;
 const select=el('transfer-recipient');const previous=select.value;
 select.disabled=true;el('transfer-create').disabled=true;el('transfer-recipients-retry').disabled=true;
 el('transfer-recipient-message').textContent='جاري تحميل المستلمين…';
 select.replaceChildren();
 try{
  await loadOwners();
  const wallets=[];let cursor=null;
  for(let page=0;page<100;page++){
   const data=await call('/wallet/funding/admin/wallets'+(cursor?'?cursor='+encodeURIComponent(cursor):''));
   wallets.push(...(data.wallets || []));cursor=data.nextCursor;
   if(!cursor)break;
  }
  if(cursor)throw Error('القائمة كبيرة؛ تعذر إكمال تحميل المستلمين.');
  const eligible=wallets.filter(w=>['DRIVER','CUSTOMER','MERCHANT'].includes(w.ownerType) && w.status==='ACTIVE');
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent=eligible.length?'اختر المستلم':'لا توجد محافظ مستلمة نشطة';select.append(placeholder);
  for(const wallet of eligible){const owner=owners.get(wallet.ownerId);const option=document.createElement('option');option.value=wallet.walletId;option.textContent=`${owner?.name || wallet.ownerId} — ${owner?.phone || 'رقم غير متوفر'}`;select.append(option);}
  if(eligible.some(w=>w.walletId===previous))select.value=previous;
  select.disabled=!eligible.length;
  el('transfer-create').disabled=!can('finance.request')||!select.value;
  el('transfer-recipient-message').textContent=eligible.length?'اختر صاحب المحفظة من القائمة. رصيد المستلم الصفري لا يمنع استقبال التحويل.':'لا توجد محافظ نشطة قابلة للاختيار.';
 }catch(e){el('transfer-recipient-message').textContent=e.message;}
 finally{recipientsLoading=false;el('transfer-recipients-retry').disabled=false;}
}
el('transfer-recipients-retry').onclick=loadRecipients;
el('transfer-recipient').onchange=()=>{el('transfer-create').disabled=!can('finance.request')||!transferPolicy?.enabled || !el('transfer-recipient').value;};
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
el('reconcile-load').onclick=async()=>{
 el('reconcile-load').disabled=true;el('reconcile-message').textContent='جاري المطابقة…';
 el('reconcile-balances').replaceChildren();el('reconcile-issues').replaceChildren();
 try{
  const data=await call('/wallet/funding/admin/reconciliation');
  if(!data.complete)throw Error(data.error);
  for(const w of data.wallets){const row=document.createElement('tr');cell(row,w.walletId==='WALLET#PLATFORM'?'المنصة':owners.get(w.walletId.replace('WALLET#DRIVER#',''))?.name || w.walletId);for(const k of ['available','locked','ledgerNet','difference'])cell(row,`${w[k]} د.ع`);el('reconcile-balances').append(row);}
  const labels={UNEXPLAINED_BALANCE:'فرق يحتاج إثباتاً',LOCKED_MISMATCH:'اختلاف المحجوز',NEGATIVE_BALANCE:'رصيد سالب',STALE_HOLD:'حجز متأخر',CAPTURE_LEDGER_MISMATCH:'قيود تثبيت غير متطابقة'};
  for(const issue of data.issues){const row=document.createElement('tr');cell(row,labels[issue.type] || issue.type);cell(row,issue.walletId);cell(row,issue.amount===undefined?'—':`${issue.amount} د.ع`);cell(row,issue.orderId || issue.holdId || '—');cell(row,issue.message);el('reconcile-issues').append(row);}
  el('reconcile-message').textContent=`آخر فحص: ${new Date(data.completedAt).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})} — ${data.issues.length} ملاحظات تحتاج مراجعة. ${data.note}`;
 }catch(e){el('reconcile-message').textContent=e.message;}
 finally{el('reconcile-load').disabled=false;}
};
let transferAttempt=null,transferCursor=null;
async function loadTransfers(more=false){
 const data=await call('/wallet/funding/admin/transfers'+(more && transferCursor?'?cursor='+encodeURIComponent(transferCursor):''));
 if(!more)el('transfer-requests').replaceChildren();
 for(const request of data.requests){
  const row=document.createElement('tr');cell(row,request.transferId);cell(row,owners.get(request.recipientWalletId.replace('WALLET#DRIVER#',''))?.name || request.recipientWalletId);cell(row,`${request.amount} د.ع`);cell(row,request.reason);cell(row,request.status==='COMPLETED'?'مكتمل':request.expiresAt<=Date.now()/1000?'انتهت المهلة':'بانتظار اعتماد مستقل');
  if(request.status==='PENDING_APPROVAL' && request.expiresAt>Date.now()/1000 && can('finance.approve') && (staffProfile?.directWrite||request.requestedBy!==staffProfile?.employee?.employeeId) && (can('bootstrap.only')||request.amount<=(staffProfile?.employee?.approvalLimit||0)))button(cell(row,''),staffProfile?.directWrite?'اعتماد التحويل':'اعتماد من مدير آخر',async()=>{if(!confirm(`اعتماد تحويل ${request.amount} دينار إلى ${request.recipientWalletId}؟`))return;await call('/wallet/funding/admin/transfer/approve','POST',{requestId:request.transferId});el('transfer-message').textContent='تم التحويل';await loadTransfers();});else cell(row,'—');
  el('transfer-requests').append(row);
 }
 transferCursor=data.nextCursor;el('transfer-more').hidden=!transferCursor;
}
el('transfer-load').onclick=()=>loadTransfers().catch(e=>el('transfer-message').textContent=e.message);
el('transfer-more').onclick=()=>loadTransfers(true).catch(e=>el('transfer-message').textContent=e.message);
el('transfer-create').onclick=async()=>{
 el('transfer-create').disabled=true;
 try{
  if(!transferPolicy?.enabled)throw Error('التحويل موقوف أو لم يتم تحميل إعداداته');
  if(!el('transfer-recipient').value)throw Error('اختر محفظة المستلم أولاً');
  const input={recipientWalletId:el('transfer-recipient').value,amount:Number(el('transfer-amount').value),reason:el('transfer-reason').value.trim()};
  if(!transferAttempt || JSON.stringify(transferAttempt.input)!==JSON.stringify(input))transferAttempt={input,requestId:crypto.randomUUID()};
  const result=await call('/wallet/funding/admin/transfer','POST',{...input,requestId:transferAttempt.requestId});
  el('transfer-message').textContent=result.status==='COMPLETED'?'تم التحويل.':'تم إنشاء الطلب؛ يحتاج اعتماد مدير مالي آخر. تطبق الحدود السارية عند الاعتماد.';await loadTransfers();
 }catch(e){el('transfer-message').textContent=e.message;}
 finally{el('transfer-create').disabled=false;}
};
const policyFields={minAmount:'أقل مبلغ',maxAmount:'أعلى مبلغ',driverDaily:'حد السائق اليومي',customerDaily:'حد الزبون اليومي',merchantDaily:'حد المطعم اليومي',platformDaily:'حد المنصة اليومي',requestTtlSeconds:'مدة الطلب بالثواني',reauthSeconds:'مدة إعادة التحقق بالثواني'};
async function loadTransferSettings(){
 try{
  const data=await call('/wallet/funding/admin/transfer-settings');transferPolicy=data.config;el('transfer-settings-propose').textContent=data.directWrite?'حفظ الإعدادات':'إرسال للاعتماد';settingsPending=data.pending;
  el('transfer-setting-enabled').checked=transferPolicy.enabled;
  el('transfer-create').disabled=!can('finance.request')||!transferPolicy.enabled || !el('transfer-recipient').value;
  for(const key of Object.keys(policyFields)){const input=el('transfer-setting-'+key);if(!input)throw Error('تعذر تحميل نموذج إعدادات التحويل. حدّث الصفحة وأعد المحاولة.');input.value=transferPolicy[key];}
  el('transfer-amount').min=transferPolicy.minAmount;el('transfer-amount').max=transferPolicy.maxAmount;
  el('transfer-policy-summary').textContent=`${transferPolicy.enabled?'التحويلات مفعلة':'التحويلات موقوفة'} — المبلغ ${transferPolicy.minAmount}–${transferPolicy.maxAmount} دينار، وحد المنصة اليومي ${transferPolicy.platformDaily} دينار. يوم بغداد. مدة الطلب ${transferPolicy.requestTtlSeconds/60} دقيقة، وتسجيل الدخول الحديث ${transferPolicy.reauthSeconds/60} دقيقة. ${data.directWrite?'يمكن للمسؤول المخوّل الحفظ مباشرة مع تسجيل الإجراء.':'يتطلب اعتماد مسؤول مالي آخر.'}`;
  el('transfer-settings-pending').replaceChildren();
  const pending=!data.directWrite&&settingsPending?.status==='PENDING' && settingsPending.expiresAt>Date.now()/1000;
  el('transfer-settings-approve').hidden=!pending||!can('finance.settings.approve');el('transfer-settings-cancel').hidden=!pending||!(can('finance.settings.request')||can('finance.settings.approve'));
  el('transfer-settings-propose').disabled=!!pending;
  if(pending){for(const key of ['enabled',...Object.keys(policyFields)]){const row=document.createElement('tr');cell(row,policyFields[key] || 'تفعيل التحويل');cell(row,String(transferPolicy[key]));cell(row,String(settingsPending.proposed[key]));el('transfer-settings-pending').append(row);}}
  el('transfer-settings-message').textContent=pending?`تعديل بانتظار اعتماد مستقل. مقدم الطلب: ${settingsPending.requestedBy}. التعديل لا يسري قبل الاعتماد.`:`الإعدادات السارية — الإصدار ${transferPolicy.version}`;
 }catch(e){transferPolicy=null;el('transfer-create').disabled=true;el('transfer-policy-summary').textContent='تعذر تحميل الحدود؛ أعد المحاولة.';el('transfer-settings-message').textContent=e.message;}
}
el('transfer-settings-load').onclick=loadTransferSettings;
el('transfer-settings-propose').onclick=async()=>{
 el('transfer-settings-propose').disabled=true;
 try{if(!transferPolicy)throw Error('أعد تحميل الإعدادات أولاً');const input={version:transferPolicy.version,enabled:el('transfer-setting-enabled').checked};for(const key of Object.keys(policyFields))input[key]=Number(el('transfer-setting-'+key).value);await call('/wallet/funding/admin/transfer-settings','POST',input);await loadTransferSettings();}
 catch(e){el('transfer-settings-message').textContent=e.message;el('transfer-settings-propose').disabled=false;}
};
el('transfer-settings-approve').onclick=async()=>{
 el('transfer-settings-approve').disabled=true;
 try{if(!settingsPending)throw Error('لا يوجد طلب إعدادات');if(!confirm('هل راجعت جميع القيم المقترحة؟ سيبدأ تطبيقها بعد الاعتماد.'))return;await call('/wallet/funding/admin/transfer-settings/approve','POST',{changeId:settingsPending.changeId});await loadTransferSettings();}
 catch(e){el('transfer-settings-message').textContent=e.message;}
 finally{el('transfer-settings-approve').disabled=false;}
};
el('transfer-settings-cancel').onclick=async()=>{
 el('transfer-settings-cancel').disabled=true;
 try{if(!settingsPending)return;if(!confirm('إلغاء طلب الإعدادات دون تغيير القيم السارية؟'))return;await call('/wallet/funding/admin/transfer-settings/cancel','POST',{changeId:settingsPending.changeId});await loadTransferSettings();}
 catch(e){el('transfer-settings-message').textContent=e.message;}
 finally{el('transfer-settings-cancel').disabled=false;}
};
el('retry').onclick=init;
init();

let lifecycleCursor=null;
async function loadLifecycle(more=false){
 const data=await call('/wallet/funding/admin/lifecycle'+(more&&lifecycleCursor?'?cursor='+encodeURIComponent(lifecycleCursor):''));
 if(!more)el('lifecycle-rows').replaceChildren();
 const labels={FULL_CASH_PENDING_COMPLETION:'محجوز حتى إتمام الطلب',DONE:'مكتملة',INTEGRATED:'تمت المزامنة',PENDING:'بانتظار المعالجة',PENDING_INTEGRATION:'بانتظار المزامنة',INTEGRATION_REVIEW_REQUIRED:'المزامنة تحتاج مراجعة',NONE:'لا يلزم إجراء إضافي',SETTLED:'تم التنفيذ، بانتظار المزامنة',MONITORING:'متابعة الطلب',RETRY:'بانتظار إعادة المحاولة',REVIEW_REQUIRED:'تحتاج مراجعة',COMPLETED:'مكتملة',MONITOR:'متابعة',CAPTURE:'تسوية',RELEASE:'فك حجز',RECONCILE:'مطابقة',REVIEW:'مراجعة',SYNC:'مزامنة'};
 const reasons={ORDER_NOT_FOUND:'الطلب غير متوفر للمطابقة',UNLINKED_HOLD:'الحجز غير مرتبط بطلب مؤكد',ASSIGNMENT_HOLD_MISMATCH:'السائق المسند لا يطابق صاحب الحجز',DELIVERY_HOLD_MISMATCH:'حجز الطلب المكتمل غير متطابق',HOLD_REPLACED_OR_MISSING:'مرجع الحجز تغير أو لم يعد متوفرًا',DELIVERED_BUT_RELEASED:'الطلب مكتمل لكن الحجز مفكوك',CANCELLED_BUT_CAPTURED:'الطلب ملغى لكن الحجز تمت تسويته',TransactionCanceledException:'تغيرت البيانات أثناء المعالجة؛ ستتم إعادة المحاولة',TimeoutError:'انقطع الاتصال؛ يتم التحقق من النتيجة',AccessDeniedException:'تعذر التنفيذ بصلاحيات الخدمة'};
 for(const op of data.operations||[]){if(op.kind==='ORDER_EXCEPTION_CASE_POINTER')continue;const row=document.createElement('tr');const kindLabels={FULL_CASH_HOLD:'حجز تحصيل السائق',MERCHANT_RESPONSE:'معالجة رد المطعم',MERCHANT_RESUME:'استئناف استقبال الطلبات',COD_ACCEPTANCE_OUTBOX:'مزامنة قبول السائق',COD_COMPLETION_OUTBOX:'مزامنة إتمام التسليم',COD_RETURN_OUTBOX:'مزامنة الإرجاع',COD_CANCEL_OUTBOX:'مزامنة الإلغاء',COD_UNASSIGN_OUTBOX:'مزامنة فك إسناد السائق'};const identity=op.orderId?'الطلب: '+op.orderId:op.branchId?'المتجر: '+op.branchId:'عملية تشغيلية';const reference=cell(row,identity);const details=document.createElement('details'),summary=document.createElement('summary'),code=document.createElement('code');summary.textContent='مرجع العملية';code.textContent=op.operationId||'غير متوفر';code.style.overflowWrap='anywhere';details.append(summary,code);reference.append(details);cell(row,kindLabels[op.kind]||labels[op.action]||'متابعة عملية');cell(row,labels[op.status]||'حالة غير معروفة');cell(row,Number.isSafeInteger(op.amount)?new Intl.NumberFormat('ar-IQ').format(op.amount)+' د.ع':'لا ينطبق');cell(row,String(op.integrationAttempts??op.attempts??0));cell(row,reasons[op.lastError||op.integrationError]||op.lastError||op.integrationError||'—');const actions=cell(row,'');if(can('finance.approve')&&!op.kind&&op.integrationSchemaVersion==null&&typeof op.orderId==='string'&&Number.isSafeInteger(op.amount)&&['RETRY','REVIEW_REQUIRED'].includes(op.status))button(actions,'إعادة المحاولة بعد المراجعة',async()=>{const reason=prompt('سبب المراجعة وإعادة المحاولة');if(!reason?.trim())return;await call('/wallet/funding/admin/lifecycle/retry','POST',{operationId:op.operationId,reason});await loadLifecycle();});el('lifecycle-rows').append(row);}
 lifecycleCursor=data.nextCursor;el('lifecycle-more').hidden=!lifecycleCursor;el('lifecycle-message').textContent='تعرض المتابعة الحجوزات ومزامنة الطلبات ومعالجة رد المطعم. «لا ينطبق» تعني أن السجل تشغيلي ولا يحمل مبلغًا ماليًا.';
}
el('lifecycle-refresh').onclick=()=>loadLifecycle().catch(e=>message(e.message));
el('lifecycle-more').onclick=()=>loadLifecycle(true).catch(e=>message(e.message));
})();
