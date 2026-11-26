'use strict';
/* Uses the staging vehicle-review actions and version contract. Production
   capabilities come from the authenticated service, never from browser roles. */
window.WizzDriverReview=(()=>{
 const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
 const errorLabels={STATE_CHANGED:'تغيرت بيانات الحساب أو صلاحياتك. حدّث الملف قبل تسجيل قرار جديد.',VEHICLE_VERSION_CONFLICT:'تغير سجل المركبات. حدّث الملف قبل تسجيل القرار.',DOCUMENT_EXPIRY_REQUIRED:'أدخل تاريخ انتهاء الوثيقة أو حدّد عدم وجوده.',DOCUMENT_ALREADY_EXPIRED:'الوثيقة منتهية الصلاحية؛ اختر طلب تصحيح.',DOCUMENT_OWNERSHIP_INVALID:'تعذر التحقق من ملكية الوثيقة.',ACCOUNT_DOCUMENTS_INCOMPLETE:'اعتمد وثائق السائق ومركبة واحدة على الأقل أولًا.',WORK_REGION_UNAVAILABLE:'منطقة العمل غير متاحة للاعتماد. راجع إعداد المنطقة.',VEHICLE_CHANGE_REQUIRES_OFFLINE:'يجب إيقاف استقبال الطلبات وإكمال الطلب الجاري أولًا.',PERMISSION_REQUIRED:'لا تتوفر صلاحية تسجيل هذا القرار.',PRODUCTION_REVIEW_UNAVAILABLE:'تسجيل القرارات لم يُفعّل بعد في الإنتاج.'};
 function field(parent,title,type='text'){const label=el('label'),n=el('input');label.append(el('span',title),n);n.type=type;parent.append(label);return n;}
 function select(parent,title,options){const label=el('label',title),n=el('select');for(const [value,text] of options){const o=el('option',text);o.value=value;n.append(o);}label.append(n);parent.append(label);return n;}
 function form({card,target,data,api,path,onSaved,isCurrent,accountDecision,refresh}){
  const account=accountDecision!==undefined;
  const fold=el('details');fold.className='review-decision';fold.append(el('summary',account?accountDecision.label:'مراجعة الوثيقة'));const f=el('form');fold.append(f);card.append(fold);
  const decision=account?null:select(f,'قرار الوثيقة',[['APPROVED','اعتماد الوثيقة'],['REJECTED','طلب تصحيح']]);
  const selectedDecision=()=>accountDecision?.value??decision.value;
  const expiryBox=el('div');f.append(expiryBox);
  const expiry=account?null:field(expiryBox,'آخر يوم لصلاحية الوثيقة بتوقيت بغداد','date');
  const noExpiry=account?null:field(expiryBox,'لا يوجد تاريخ انتهاء ظاهر في الوثيقة','checkbox');
  if(expiry)noExpiry.onchange=()=>{expiry.disabled=noExpiry.checked;expiry.required=!noExpiry.checked;};
  const reasonLabel=el('label','سبب القرار'),reason=el('textarea');reason.rows=3;reason.maxLength=1000;reason.required=true;reasonLabel.append(reason);f.append(reasonLabel);
  const result=el('p');result.role='alert';f.append(result);const submit=el('button',account?accountDecision.label:'حفظ قرار الوثيقة');submit.type='submit';f.append(submit);
  const update=()=>{expiryBox.hidden=account||selectedDecision()!=='APPROVED';if(expiry)expiry.required=selectedDecision()==='APPROVED'&&!noExpiry.checked;};if(decision)decision.onchange=update;update();
  let busy=false;
  f.onsubmit=async e=>{e.preventDefault();if(busy||!isCurrent())return;if(!reason.value.trim()){result.textContent='اكتب سبب القرار.';return;}if(!f.reportValidity())return;
   busy=true;const controls=[...f.querySelectorAll('input,textarea,select,button')];controls.forEach(n=>n.disabled=true);result.textContent='جارٍ تسجيل القرار…';
   try{const body={...target,expectedVersion:data.version,decision:selectedDecision(),reason:reason.value.trim(),...(!account&&selectedDecision()==='APPROVED'?{expiryDate:noExpiry.checked?null:expiry.value,noExpiry:noExpiry.checked}:{})};const next=await api(path,body);if(isCurrent())onSaved(next,target.action,body.decision);}
   catch(error){if(!isCurrent())return;result.textContent=errorLabels[error.code]||error.message||'تعذر تأكيد القرار. حدّث الملف للتحقق من النتيجة.';
    // A timeout may follow a committed transaction. Never retry a decision
    // automatically or reuse its stale expectedVersion after an uncertain result.
    const retry=el('button','تحديث ملف السائق');retry.type='button';retry.onclick=refresh;
    result.append(el('br'),retry);}
  };
 }
 function initialize({root,data,api,path,isCurrent,onSaved}){
  const card=el('section');card.className='review-summary';
  card.append(el('h3','تهيئة سجل المركبات'),el('p','تُحفظ بيانات المركبة الموجودة في سجل قابل للمراجعة، دون اعتماد الحساب أو الوثائق تلقائيًا.'));
  const f=el('form'),label=el('label','سبب التهيئة'),reason=el('textarea'),result=el('p'),button=el('button','تهيئة السجل للمراجعة');
  reason.required=true;reason.maxLength=1000;reason.rows=2;label.append(reason);result.role='alert';button.type='submit';f.append(label,result,button);card.append(f);root.append(card);
  let busy=false;
  f.onsubmit=async e=>{e.preventDefault();if(busy||!isCurrent()||!f.reportValidity())return;
   if(!reason.value.trim()){result.textContent='اكتب سبب التهيئة.';return;}
   busy=true;reason.disabled=true;button.disabled=true;result.textContent='جارٍ تهيئة السجل…';
   try{const next=await api(path,{action:'INITIALIZE',expectedVersion:data.version,reason:reason.value.trim()});if(isCurrent())onSaved(next,'INITIALIZE');}
   catch(error){if(!isCurrent())return;result.textContent=(errorLabels[error.code]||'تعذر تأكيد تهيئة السجل.')+' حدّث ملف السائق للتحقق قبل إعادة المحاولة.';button.textContent='حدّث الملف قبل إعادة المحاولة';}
  };
 }
 const documentNames={drivingLicense:'إجازة السوق / رخصة القيادة',nationalId:'البطاقة الوطنية'};
 const accountLabels={APPROVED:'معتمد',VERIFIED:'معتمد',ACTIVE:'معتمد',SUSPENDED:'معلّق',BANNED:'محظور',REJECTED:'مرفوض',PENDING_PROFILE:'الملف غير مكتمل',PENDING_DOCS:'بانتظار الوثائق',PENDING_REVIEW:'بانتظار المراجعة'};
 const eligibilityNotes={
  ACTIVE_VEHICLE_NOT_APPROVED:'على السائق اختيار مركبة معتمدة للعمل من تطبيقه.',
  ACTIVE_VEHICLE_REFERENCE_CHANGED:'تحتاج بيانات المركبة المختارة للعمل إلى تحديث.',
  DRIVER_DOCUMENT_REVIEW_REQUIRED:'أكمل مراجعة وثائق السائق الحالية.',
  DRIVER_WORK_REGION_REQUIRED:'راجع منطقة عمل السائق.',
  VEHICLE_INITIAL_REVIEW_REQUIRED:'هيّئ سجل المركبات وأكمل مراجعته.'
 };
 function accountActions(status,ready,canSuspend){
  const approved=['APPROVED','VERIFIED','ACTIVE'].includes(status);
  return {
   approve:ready&&!approved&&status!=='BANNED'
    ? {value:'APPROVED',label:status==='SUSPENDED'||status==='REJECTED'?'إعادة اعتماد الحساب':'اعتماد حساب السائق'}
    :null,
   restrict:[
    ...(approved&&canSuspend?[{value:'SUSPENDED',label:'تعليق حساب السائق'}]:[]),
    ...(!['BANNED','REJECTED','SUSPENDED'].includes(status)?[{value:'REJECTED',label:'رفض اعتماد الحساب'}]:[])
   ]
  };
 }

 function render({root,row,data,api,refresh,isCurrent,documentRow,onSaved}){
  const status=data.profile?.status??row.status;
  const docs=data.documents||[];
  const registeredVehicles=(data.vehicles||[]).filter(v=>!v.removedAt);
  const missingDocs=Object.keys(documentNames).filter(kind=>docs.find(doc=>doc.kind===kind)?.status!=='APPROVED');
  const hasApprovedVehicle=registeredVehicles.some(v=>v.effectiveStatus==='APPROVED');
  const hasRegion=Boolean(data.profile?.workRegionId);
  const approved=['APPROVED','VERIFIED','ACTIVE'].includes(status);
  const enabled=data.capabilities?.review===true;
  const ready=data.initialized&&missingDocs.length===0&&hasApprovedVehicle&&hasRegion;
  const path='/staff/drivers/'+encodeURIComponent(row.driverId)+'/vehicles';
  const formContext={data,api,path,isCurrent,onSaved,refresh};

  const summary=el('section');summary.className='review-summary driver-review-overview';
  summary.append(el('h3','حالة الحساب'));
  const badge=el('p',accountLabels[status]||'حالة غير متاحة');badge.className='driver-review-state';badge.dataset.state=approved?'approved':status==='SUSPENDED'||status==='REJECTED'?'restricted':'pending';
  summary.append(badge,el('p','منطقة العمل · '+([data.profile?.governorateName,data.profile?.workRegionName].filter(Boolean).join(' · ')||'غير محددة')));
  const next=approved?(data.eligibility?.eligible?'الحساب مؤهل لاستقبال الطلبات عند اتصال السائق.':eligibilityNotes[data.eligibility?.code]||'راجع أهلية المركبة والوثائق للعمل.')
   :!enabled?'اعرض الملف للتحقق من حالته.'
   :!data.initialized?'ابدأ بتهيئة سجل المركبات.'
   :missingDocs.length?'الخطوة التالية هي مراجعة '+missingDocs.map(kind=>documentNames[kind]).join(' و')+'.'
   :!hasApprovedVehicle?'الخطوة التالية هي اعتماد سنوية مركبة واحدة على الأقل.'
   :!hasRegion?'منطقة العمل مطلوبة لاعتماد الحساب.'
   :status==='SUSPENDED'?'الحساب معلّق. إذا كان القرار المطلوب هو التفعيل، استخدم «إعادة اعتماد الحساب».'
   :status==='BANNED'?'الحساب محظور.'
   :'اكتملت المتطلبات. يمكنك الآن تسجيل اعتماد الحساب.';
  summary.append(el('p',next));
  const reload=el('button','تحديث ملف السائق');reload.type='button';reload.onclick=refresh;summary.append(reload);
  root.append(summary);

  if(enabled&&!data.initialized)initialize({root,...formContext});
  const documents=el('section');documents.className='review-group';
  documents.append(el('h2','١. وثائق السائق'));
  const documentCards=el('div');documentCards.className='review-document-grid';documents.append(documentCards);root.append(documents);
  for(const doc of docs){
   const card=documentRow(row.driverId,documentNames[doc.kind],doc.status,doc.uploaded,{kind:doc.kind});
   if(doc.review?.reason)card.append(el('p','سبب آخر قرار · '+doc.review.reason));
   documentCards.append(card);
   if(enabled&&data.initialized&&doc.uploaded)form({card,target:{action:'REVIEW_DOCUMENT',documentKind:doc.kind},...formContext});
  }
  const vehicles=el('section');vehicles.className='review-group';
  vehicles.append(el('h2','٢. المركبات وسنوياتها'));root.append(vehicles);
  for(const v of registeredVehicles){
   const title=[v.type==='car'?'سيارة':v.type==='motorcycle'?'دراجة نارية':'مركبة',v.plateNumber,v.make,v.model].filter(Boolean).join(' · ');
   const card=documentRow(row.driverId,title,v.effectiveStatus,Boolean(v.registrationUrl),{kind:'registrationPaper',vehicleId:v.id});
   if(v.id===data.activeId)card.append(el('p','المركبة المختارة للعمل'));
   if(v.review?.reason)card.append(el('p','سبب آخر قرار · '+v.review.reason));
   vehicles.append(card);
   if(enabled&&data.initialized&&v.registrationUrl)form({card,target:{action:'REVIEW',vehicleId:v.id},...formContext});
  }
  if(!registeredVehicles.length)vehicles.append(el('p','لا توجد مركبات مسجلة.'));

  const account=el('section');account.className='review-group review-account';
  account.append(el('h2','٣. اعتماد الحساب'));root.append(account);
  const actions=accountActions(status,ready,data.capabilities?.suspend===true);
  if(approved)account.append(el('p','اعتماد الحساب مسجّل.'));
  if(!approved&&!ready)account.append(el('p','أكمل المتطلبات الموضّحة في حالة الحساب أعلاه.'));
  const target={action:'REVIEW_ACCOUNT'};
  if(enabled&&actions.approve)form({card:account,target,accountDecision:actions.approve,...formContext});
  if(enabled&&data.initialized&&actions.restrict.length){
   const restrictions=el('details');restrictions.className='review-restrictions';
   restrictions.append(el('summary','الرفض والتعليق'));
   for(const accountDecision of actions.restrict)form({card:restrictions,target,accountDecision,...formContext});
   root.append(restrictions);
  }
  const history=el('details');history.className='review-history';history.append(el('summary','سجل الإجراءات والمراجعات'));
  const actionLabels={INITIALIZE:'تهيئة سجل المركبات',REVIEW_DOCUMENT:'مراجعة وثيقة',REVIEW:'مراجعة سنوية المركبة',REVIEW_ACCOUNT:'قرار الحساب',ADD:'إضافة مركبة',UPDATE:'تحديث مركبة',REMOVE:'إزالة مركبة',SELECT:'اختيار مركبة للعمل',SELECT_DEFAULT:'اختيار المركبة الوحيدة'};
  const decisionLabels={APPROVED:'اعتماد',SUSPENDED:'تعليق',REJECTED:'رفض'};
  const formatter=new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
  for(const event of [...(data.events||[])].reverse()){
   const date=new Date(event.at),at=Number.isFinite(date.getTime())?formatter.format(date):'التاريخ غير متاح';
   history.append(el('p',[at,actionLabels[event.action]||'إجراء على الملف',decisionLabels[event.decision],event.reason].filter(Boolean).join(' · ')));
  }
  if(!data.events?.length)history.append(el('p','لا توجد مراجعات مسجلة بعد.'));
  root.append(history);
 }
 return {render};
})();
