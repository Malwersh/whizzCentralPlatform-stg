(function(){'use strict';const el=id=>document.getElementById(id);let agreement,busy=false;const message=(id,text)=>el(id).textContent=text;
async function api(path,body){await window.Auth.ensureSession();const response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+'/staff/merchants/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Error(({PERMISSION_REQUIRED:'ليست لديك صلاحية هذا الإجراء.',GLOBAL_SCOPE_REQUIRED:'تعديل الاتفاقية يحتاج نطاق المنصة الكامل.',NEW_AGREEMENT_VERSION_REQUIRED:'غيّر رقم الإصدار عند تغيير نص الاتفاقية.',VERSION_OR_STATE_CONFLICT:'تغير الطلب أو الإعداد. أعد تحميله.',INVALID_REVIEW:'أدخل سببًا واضحًا من خمسة أحرف على الأقل.',TRANSFER_NOT_FOUND:'لم يُعثر على طلب نقل بهذا المرجع.',INVALID_TRANSFER_REFERENCE:'تحقق من معرّف المؤسسة ومرجع الطلب.',REAUTH_REQUIRED:'أعد تسجيل الدخول لاعتماد نقل الملكية.',TRANSFER_MUTATION_FENCE_REQUIRED:'لم يكتمل التحقق من إيقاف تغييرات الفروع والصلاحيات والتسويات.',TRANSFER_EXECUTION_EVIDENCE_REQUIRED:'لم تكتمل أدلة التسويات والصلاحيات.',TRANSFER_FINANCIAL_BLOCKERS:'توجد موانع مالية تمنع النقل.',TRANSFER_SETTLEMENT_APPROVAL_REQUIRED:'على المراجع المالي مراجعة وجهة التسويات ثم الضغط على «اعتماد وجهة التسويات».',TRANSFER_DESTINATION_VERIFICATION_REQUIRED:'اطلب من المالك الجديد فتح الطلب في تطبيق المطاعم وتأكيد هاتف التسويات، ثم أعد الفحص.',TRANSFER_ACTIVE_ACCESS:'توجد صلاحيات أو دعوات أو أجهزة نشطة. أعد فحص الموانع بعد معالجتها.',TRANSFER_ACCESS_INVENTORY_INCOMPLETE:'تعذّر إكمال فحص صلاحيات الفروع. أحِل الطلب إلى فريق تشغيل المنصة.'})[data.error]||'تعذر تنفيذ العملية. أعد المحاولة.');return data;}
async function loadAgreement(){try{agreement=await api('agreement');el('merchant-agreement-version').value=agreement.version;el('merchant-agreement-text').value=agreement.textAr;el('merchant-agreement-ready').checked=agreement.ready;el('merchant-agreement-form').hidden=!agreement.canEdit;message('merchant-agreement-message',agreement.ready?'الاتفاقية متاحة لقبول المتقدمين.':'الاتفاقية غير جاهزة للتقديم؛ يمكن حفظ المسودات.');}catch(e){message('merchant-agreement-message',e.message);}}
function paragraph(parent,label,value){const p=document.createElement('p');p.textContent=label+': '+(value||'—');parent.append(p);}
async function applications(){try{const data=await api('applications');el('merchant-applications-list').replaceChildren();for(const application of data.items){const d=application.draft,card=document.createElement('article');card.style.cssText='border:1px solid #ddd;border-radius:12px;padding:16px;margin:12px 0';const title=document.createElement('h3');title.textContent=d.name;card.append(title);paragraph(card,'نوع النشاط',d.businessTypeId);paragraph(card,'المناطق',(d.regionNames||[]).join(' ← '));paragraph(card,'العنوان',d.address);paragraph(card,'هاتف الفرع',d.contactPhone);paragraph(card,'الموقع',d.latitude+', '+d.longitude);paragraph(card,'الوصف',d.description);paragraph(card,'شهادة التسجيل',d.registrationCertificateAssetId?'مرفقة':'لم تُرفق — اختيارية');paragraph(card,'نسخة الاتفاقية',d.submission?.agreement?.version);if(data.canReadDocuments){for(const [field,label] of [['registrationCertificateAssetId','شهادة التسجيل'],['businessPhotoAssetId','صورة النشاط']]){if(!d[field])continue;const b=document.createElement('button');b.textContent='عرض '+label;b.onclick=async()=>{b.disabled=true;try{const file=await api('application-asset?queueKey='+encodeURIComponent(application.queueKey)+'&assetId='+encodeURIComponent(d[field]));const link=document.createElement('a');link.href=file.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='فتح '+label+' — الرابط صالح دقيقة';b.replaceWith(link);}catch(e){b.disabled=false;message('merchant-applications-message',e.message);}};card.append(b);}}if(data.canReview){const reason=document.createElement('textarea');reason.placeholder='سبب القرار أو البيانات المطلوب استكمالها';reason.maxLength=1000;reason.style.width='100%';card.append(reason);for(const [label,decision]of [['اعتماد الفرع','APPROVE'],['يحتاج استكمالًا','NEEDS_INFORMATION'],['رفض الطلب','REJECT']]){const button=document.createElement('button');button.textContent=label;button.onclick=async()=>{if(busy)return;if(reason.value.trim().length<5){message('merchant-applications-message','اكتب سبب القرار من خمسة أحرف على الأقل.');return;}busy=true;try{await api('applications/review',{queueKey:application.queueKey,baseVersion:d.version,decision,reason:reason.value.trim()});await applications();message('merchant-applications-message','تم حفظ القرار. الفرع المعتمد يحتاج إكمال تجهيزاته قبل التشغيل.');}catch(e){message('merchant-applications-message',e.message);}finally{busy=false;}};card.append(button);}}el('merchant-applications-list').append(card);}message('merchant-applications-message',data.items.length?'عدد الطلبات: '+data.items.length:'لا توجد طلبات تنتظر المراجعة ضمن نطاقك.');}catch(e){message('merchant-applications-message',e.message);}}
const transferLookup=el('merchant-transfer-lookup');
if(transferLookup){
 const labels={AWAITING_RECIPIENT:'بانتظار قبول المالك الجديد',AWAITING_REVIEW:'بانتظار مراجعة الإدارة',REJECTED:'مرفوض',CANCELLED:'ملغى',COMPLETED:'مكتمل',EXPIRED:'منتهي الصلاحية'};
 const output=el('merchant-transfer-result'),rejectForm=el('merchant-transfer-reject'),reason=el('merchant-transfer-reason');
 const preflightButton=el('merchant-transfer-preflight'),blockers=el('merchant-transfer-blockers');
 let current=null,transferBusy=false,executionAvailable=false;
 function display(data){
  const previous=current?.requestId===data.request.requestId?current:null;
  current={...data.request,branchNames:data.request.branchNames??previous?.branchNames};
  executionAvailable=data.executionAvailable??(previous?executionAvailable:false);
  output.replaceChildren();
  const card=document.createElement('section');
  card.className='merchant-transfer-card';
  const heading=document.createElement('h3');
  heading.textContent=labels[current.status]||current.status;
  card.append(heading);
  const names=(current.branchNames||[]).filter(Boolean);
  const total=current.branchIds?.length||0;
  if(names.length)paragraph(card,'الفروع المشمولة',names.join('، '));
  if(names.length<total)paragraph(card,'عدد الفروع المشمولة',String(total));
  if(current.agreementVersion)paragraph(card,'إصدار الاتفاقية المقبولة',current.agreementVersion);
  output.append(card);
  if(['AWAITING_RECIPIENT','AWAITING_REVIEW'].includes(current.status)){
   const process=document.createElement('section');
   process.className='merchant-transfer-card';
   const title=document.createElement('h3');
   title.textContent='الإجراء المطلوب الآن';
   process.append(title);
   const waiting=current.status==='AWAITING_RECIPIENT';
   const note=document.createElement('p');
   note.textContent=waiting
    ?'المالك الجديد يراجع الدعوة ويقبلها من تطبيق المطعم. الإدارة تتابع الحالة إلى حين القبول.'
    :'المراجع يفتح فحص الموانع ويحدد الجهة المسؤولة عن معالجة كل مانع قبل اتخاذ القرار.';
   process.append(note);
   const stepsTitle=document.createElement('h4');
   stepsTitle.textContent='خطوات الإدارة بعد القبول';
   process.append(stepsTitle);
   const steps=document.createElement('ol');
   for(const text of [
    'مراجع الطلب يفحص موانع الفروع، ومنها الطلبات القائمة والأرصدة والصلاحيات. يعيد الفحص بعد معالجتها.',
    'المالك الجديد يؤكد هاتف التسويات في التطبيق. المراجع المالي يراجع الوجهة ويعتمدها.',
    'المراجع المخوّل يعتمد النقل بعد اكتمال الشروط، أو يرفض الطلب ويسجّل السبب.',
   ]){
    const step=document.createElement('li');
    step.textContent=text;
    steps.append(step);
   }
   process.append(steps);
   if(!waiting&&!executionAvailable){
    const flag=document.createElement('p');
    flag.textContent='تنفيذ الاعتماد النهائي غير مفعّل في ستيجنج حاليًا.';
    process.append(flag);
   }
   output.append(process);
  }
  const settlement=data.settlement;
  if(settlement){
   const labels={
    VERIFICATION_REQUIRED:'بانتظار تأكيد هاتف التسويات من المالك الجديد',
    REVIEW_REQUIRED:'الهاتف مؤكّد وبانتظار اعتماد المراجع المالي',
    APPROVED:'اعتمد المراجع المالي وجهة التسويات',
   };
   paragraph(card,'وجهة التسويات',labels[settlement.status]||settlement.status);
   if(settlement.maskedPhone)paragraph(card,'هاتف التسويات',settlement.maskedPhone);
  }

  blockers.replaceChildren();
  preflightButton.hidden=!data.canPreflight;
  rejectForm.hidden=!data.canReject&&!data.canApprove&&!data.canApproveSettlement;
  el('merchant-transfer-settlement').hidden=!data.canApproveSettlement;
  el('merchant-transfer-approve').hidden=!data.canApprove;
 }
 async function openTransfer(organizationId,requestId){
  if(transferBusy)return;
  transferBusy=true;current=null;rejectForm.hidden=true;preflightButton.hidden=true;blockers.replaceChildren();output.replaceChildren();reason.value='';
  message('merchant-transfer-message','جارٍ تحميل الطلب…');
  try{
   const parameters=new URLSearchParams({organizationId,requestId});
   display(await api('ownership-transfer?'+parameters));
   message('merchant-transfer-message','');
  }catch(error){message('merchant-transfer-message',error.message);}
  finally{transferBusy=false;}
 }
 transferLookup.onsubmit=event=>{
  event.preventDefault();
  const reference=el('merchant-transfer-reference').value.trim();
  const match=/^([A-Za-z0-9_-]{1,128})\/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i.exec(reference);
  if(match)openTransfer(match[1],match[2]);
  else message('merchant-transfer-message','الصق مرجع الطلب كاملًا كما نُسخ من تطبيق المطعم.');
 };
 const queue=el('merchant-transfer-queue');
 if(queue){
  const section=el('merchant-ownership-transfer-section');
  const refresh=el('merchant-transfer-queue-refresh');
  const more=el('merchant-transfer-queue-more');
  let cursor=null,loading=false;
  async function loadQueue(reset){
   if(loading)return;
   loading=true;
   refresh.disabled=more.disabled=true;
   try{
    const query=new URLSearchParams({view:'active'});
    if(!reset&&cursor)query.set('cursor',cursor);
    const result=await api('ownership-transfer?'+query);
    if(reset)queue.replaceChildren();
    for(const request of result.requests){
     const item=document.createElement('li');
     item.className='merchant-transfer-queue-row';
     const button=document.createElement('button');
     button.type='button';
     button.className='btn-secondary';
     button.textContent=request.businessName||'نشاط تجاري';
     button.onclick=()=>openTransfer(request.organizationId,request.requestId);
     const status=document.createElement('span');
     status.textContent=labels[request.status]||request.status;
     if(request.branchCount>1)status.textContent+=' — '+request.branchCount+' فروع';
     item.append(button,status);
     queue.append(item);
    }
    cursor=result.nextCursor;
    more.hidden=!cursor;
    message('merchant-transfer-queue-message',queue.children.length?'':cursor
     ?'اضغط «عرض المزيد» لمتابعة البحث عن الطلبات النشطة.'
     :'لا توجد طلبات نقل ملكية نشطة.');
   }catch(error){message('merchant-transfer-queue-message',error.message);}
   finally{loading=false;refresh.disabled=more.disabled=false;}
  }
  refresh.onclick=()=>loadQueue(true);
  more.onclick=()=>loadQueue(false);
  section.addEventListener('toggle',()=>{if(section.open)loadQueue(true);});
  if(window.location.hash==='#merchant-ownership-transfer-section')section.open=true;
  if(section.open)loadQueue(true);
 }
 const finance={label:'فتح المحافظ والتسويات',href:'finance.html'};
 const orders={label:'فتح إدارة الطلبات',href:'orders-management.html'};
 const blockerGuidance={
  BRANCH_SCOPE_CHANGED:{
   title:'تغيّرت بيانات الفرع أو نطاق الطلب',owner:'مراجع التجّار والمالك الحالي',
   steps:'قارن قائمة الفروع في الطلب مع الأنشطة المملوكة حاليًا. إذا تغيّر النطاق أو المالك، ارفض الطلب المتقادم لتقديم طلب جديد يقبله الطرفان.',
  },
  ACTIVE_ORDERS:{
   title:'طلبات قائمة',owner:'فريق تشغيل الطلبات',link:orders,
   steps:'ابحث عن طلبات الفرع المفتوحة وأكملها أو عالج الإلغاء عبر مسار الطلب المعتمد. أعد الفحص بعد انتقال الطلبات إلى حالات نهائية.',
  },
  ACTIVE_HOLDS:{
   title:'حجوزات نشطة',owner:'المراجع المالي',link:finance,
   steps:'طابق الحجز مع الطلب أو العملية المالية التي أنشأته. أكمل العملية أو حرّر الحجز من مسارها المعتمد بعد مراجعة سبب الحجز.',
  },
  PENDING_TOPUPS:{
   title:'طلبات شحن معلّقة',owner:'مراجع الشحن',link:finance,
   steps:'راجع طلبات شحن محفظة الفرع وطابق وصول التحويل مع الوصل. اعتمد الطلب المستحق أو ارفضه بسبب موثّق، ثم عالج أي رصيد متبقٍ.',
  },
  PENDING_TRANSFERS:{
   title:'تحويلات معلّقة',owner:'المراجع المالي',link:finance,
   steps:'تحقق من التحويلات الصادرة والواردة لهذه المحفظة. أكمل المعاملة المستحقة أو ألغها وفق حالتها وصلاحيتك، ثم تحقق من الأثر على الرصيد.',
  },
  PENDING_PAYOUTS:{
   title:'عمليات صرف معلّقة',owner:'فريق التسويات',link:finance,
   steps:'طابق طلب الصرف مع نتيجة الدفع الفعلية وأثبت النتيجة في مسار التسويات. إذا تعذّر تأكيد الدفع، ارفع الحالة للمطابقة قبل إعادة المحاولة.',
  },
  PENDING_CORRECTIONS:{
   title:'تصحيحات مالية معلّقة',owner:'فريق التسويات',link:finance,
   steps:'راجع التصحيح المرتبط بالفرع وأكمل اعتماده أو رفضه. سوِّ أي حجز تابع له من مسار التصحيح قبل إعادة الفحص.',
  },
  ACTIVE_DEVICES:{
   title:'أجهزة مرتبطة',owner:'المالك الحالي',
   steps:'اطلب من المالك الحالي فتح إدارة أجهزة الفرع في تطبيق المطاعم وإلغاء ربط أجهزة الاستقبال المرتبطة به. يربط المالك الجديد أجهزته بعد اكتمال النقل.',
  },
  ACTIVE_MEMBERSHIPS:{
   title:'عضويات نشطة',owner:'المالك الحالي',
   steps:'اطلب من المالك الحالي مراجعة موظفي الفرع وإلغاء العضويات النشطة. بعد اكتمال النقل، يدعو المالك الجديد من يحتاج إلى منحه صلاحيات.',
  },
  PENDING_STAFF_INVITATIONS:{
   title:'دعوات موظفين معلّقة',owner:'المالك الحالي',
   steps:'اطلب من المالك إلغاء الدعوات غير المقبولة من صفحة موظفي الفرع، أو انتظر انتهاء صلاحيتها ثم أعد الفحص.',
  },
  PENDING_DEVICE_PAIRING:{
   title:'رمز ربط جهاز سارٍ',owner:'المالك الحالي',
   steps:'أوقف إجراءات ربط الأجهزة وانتظر انتهاء صلاحية رمز الربط الحالي، ثم أعد الفحص.',
  },
  ACTIVE_FINANCIAL_GRANTS:{
   title:'صلاحيات مالية نشطة',owner:'المالك الحالي والمراجع المالي',link:finance,
   steps:'اطلب من المالك الحالي سحب تفويضات محفظة الفرع من إدارة الصلاحيات المالية. يتحقق المراجع من زوال التفويضات قبل الاعتماد.',
  },
  WALLET_EVIDENCE_UNAVAILABLE:{
   title:'تعذّر التحقق من المحفظة',owner:'فريق المحفظة',link:finance,
   steps:'تحقق من أن المحفظة مرتبطة بمعرّف الفرع الصحيح وأن الرصيد المتاح والمحجوز قابلان للقراءة. أحِل الحالة للدعم المالي إذا كان السجل ناقصًا.',
  },
  WALLET_BALANCE:{
   title:'رصيد يحتاج تسوية',owner:'المراجع المالي والمالك الحالي',link:finance,
   steps:'طابق الرصيد مع سجل المحفظة ووافق على معالجة الرصيد الموجب أو تحصيل المبلغ المستحق عبر مسار التسوية. تحقق من وصول الرصيد المتاح إلى صفر.',
  },
  WALLET_LOCKED:{
   title:'رصيد محجوز',owner:'المراجع المالي',link:finance,
   steps:'حدّد الطلب أو التحويل الذي حجز المبلغ. أكمل العملية أو حرّر الحجز عبر مسارها المعتمد، ثم تحقق من وصول الرصيد المحجوز إلى صفر.',
  },
 };
 preflightButton.onclick=async()=>{
  if(!current||transferBusy)return;
  transferBusy=true;preflightButton.disabled=true;blockers.replaceChildren();
  message('merchant-transfer-message','جارٍ فحص البيانات الحالية…');
  try{
   const query=new URLSearchParams({organizationId:current.organizationId,requestId:current.requestId});
   const data=await api('ownership-transfer/preflight?'+query);
   for(const branch of data.branches){
    const card=document.createElement('article'),title=document.createElement('h3');
    card.className='merchant-transfer-card';
    title.textContent=branch.name;card.append(title);
    for(const item of branch.blockers){
     const value=item.amount!==undefined?new Intl.NumberFormat('ar-IQ').format(item.amount)+' د.ع':String(item.count);
     const guide=blockerGuidance[item.code]||{
      title:'مانع يحتاج مراجعة ('+item.code+')',owner:'فريق تشغيل المنصة',
      steps:'أرسل مرجع الطلب والفرع ورمز المانع إلى فريق تشغيل المنصة للتحقق من السجل وإعادة الفحص.',
     };
     const detail=document.createElement('section');
     paragraph(detail,guide.title,value);
     paragraph(detail,'المسؤول عن الحل',guide.owner);
     paragraph(detail,'خطوة الحل',guide.steps);
     if(guide.link){
      const link=document.createElement('a');link.href=guide.link.href;link.textContent=guide.link.label;
      link.target='_blank';link.rel='noopener';detail.append(link);
     }
     card.append(detail);
    }
    if(!branch.blockers.length){
     const note=document.createElement('p');note.textContent='لم يرصد الفحص الحالي موانع في البيانات التي راجعها.';card.append(note);
    }
    blockers.append(card);
   }
   message('merchant-transfer-message',data.branches.some(branch=>branch.blockers.length)
    ?'بعد معالجة الموانع، اضغط «فحص موانع الاعتماد» مجددًا.'
    :'لم يرصد الفحص الحالي موانع. راجع حالة وجهة التسويات قبل اتخاذ القرار.');
  }catch(error){message('merchant-transfer-message',error.message);}
  finally{transferBusy=false;preflightButton.disabled=false;}
 };
 rejectForm.onsubmit=async event=>{
  event.preventDefault();
  if(transferBusy||!current||reason.value.trim().length<5)return;
  const action=event.submitter?.value;
  if(!['approve','approve-settlement','reject'].includes(action))return;
  const prompts={
   approve:'تأكيد اعتماد نقل ملكية النشاط وفروعه؟',
   'approve-settlement':'هل راجعت وجهة التسويات وأنت جاهز لاعتمادها للمالك الجديد؟',
   reject:'تأكيد رفض طلب نقل الملكية؟',
  };
  if(!window.confirm(prompts[action]))return;
  transferBusy=true;
  try{
   display(await api('ownership-transfer/'+action,{
    organizationId:current.organizationId,requestId:current.requestId,
    baseVersion:current.version,reason:reason.value.trim(),
   }));
   reason.value='';
   const result={
    approve:'اعتُمد نقل الملكية.',
    'approve-settlement':'اعتمدت الإدارة وجهة التسويات. يمكن متابعة مراجعة طلب النقل.',
    reject:'رُفض طلب النقل ورُفع الإيقاف المرتبط به.',
   };
   message('merchant-transfer-message',result[action]);
   if(action!=='approve-settlement')el('merchant-transfer-queue-refresh')?.click();
  }catch(error){message('merchant-transfer-message',error.message);}
  finally{transferBusy=false;}
 };
}
el('merchant-agreement-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;try{await api('agreement',{baseVersion:agreement.baseVersion,version:el('merchant-agreement-version').value.trim(),textAr:el('merchant-agreement-text').value.trim(),ready:el('merchant-agreement-ready').checked,reason:el('merchant-agreement-reason').value.trim()});await loadAgreement();}catch(e){message('merchant-agreement-message',e.message);}finally{busy=false;}};el('merchant-applications-reload').onclick=applications;loadAgreement();applications();})();
