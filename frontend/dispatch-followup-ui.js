(function(){'use strict';
 const titles={CLAIM:'أتولى متابعة الطلب',RELEASE:'إعادة إلى قائمة غير المسندة',NOTE:'حفظ ملاحظة المتابعة'};
 const errors={FOLLOWUP_CHANGED:'تغيرت المتابعة. حدّث الحالة قبل الحفظ.',FOLLOWUP_OWNED_BY_OTHER:'يتابع هذا الطلب موظف آخر. اطلب منه تحرير المتابعة أولًا.',FOLLOWUP_CLAIM_REQUIRED:'تولّ متابعة الطلب قبل تسجيل الملاحظة.',REVIEW_ACTION_NOT_ALLOWED:'لم تعد الحالة قابلة لهذه المتابعة. حدّث الطلب.',REAUTH_REQUIRED:'أعد تسجيل الدخول قبل الحفظ.',ENROLLMENT_REQUIRED:'أكمل التحقق الثنائي لحسابك.',PERMISSION_REQUIRED:'لا تملك صلاحية متابعة هذه المنطقة.'};
 const text=(tag,value)=>{const n=document.createElement(tag);n.textContent=value;return n;};
 const when=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad',hour:'2-digit',minute:'2-digit',day:'numeric',month:'short'}):'غير مسجل';};
 window.DispatchFollowupUI={render(item,refresh){
  const f=item.followup,box=document.createElement('section');box.className='dispatch-followup-card';if(!f)return box;
  const severity=!f.active?'المتابعة غير نشطة':f.escalated?'متأخر — يحتاج تدخل المشرف':f.overdue?'تجاوز موعد المراجعة':f.ownerId?'قيد المتابعة':'بانتظار مسؤول متابعة';
  box.append(text('strong',severity),text('p','مسؤول المتابعة: '+(f.ownerName||'لم يتولّها أحد بعد')),text('p','بدء التعثر: '+when(f.firstObservedAt)+' • المراجعة حتى '+when(f.reviewDueAt)),text('p','التصعيد عند '+when(f.escalationDueAt)+' — بتوقيت بغداد'));
  if(f.ownerUnavailable)box.append(text('p','مسؤول المتابعة السابق غير متاح أو لم يعد مخوّلًا؛ يمكن لموظف مخوّل تولّي الحالة دون تمديد المهلة.'));
  if(f.restartState)box.append(text('p',f.restartState==='NEEDS_REVIEW'?'تعذر تأكيد تشغيل العروض؛ افتح إدارة الطلب لمعالجة الحالة.':'يبقى التنبيه مفتوحًا حتى يؤكد المنفذ تشغيل دورة البحث.'));
  if(f.lastNote)box.append(text('p','آخر ملاحظة: '+f.lastNote));
  if(!f.active)return box;
  const actions=[];if(f.canClaim&&(!f.ownerId||f.ownerUnavailable))actions.push('CLAIM');if(f.canRelease)actions.push('NOTE','RELEASE');
  if(!actions.length)return box;
  const note=document.createElement('textarea');note.placeholder='ملاحظة المتابعة أو سبب تولّيها (٥ أحرف على الأقل)';note.maxLength=1000;note.setAttribute('aria-label','ملاحظة متابعة تعذر التوزيع');box.append(note);
  const status=text('p','');status.setAttribute('role','status');let busy=false,saved;
  for(const action of actions){const button=text('button',titles[action]);button.type='button';box.append(button);button.addEventListener('click',async()=>{
   if(busy)return;if(note.value.trim().length<5){status.textContent='اكتب ملاحظة واضحة من خمسة أحرف على الأقل.';return;}
   const payload={selector:{orderId:item.orderId,source:item.source,...(item.attemptId?{attemptId:item.attemptId}:{})},action,baseVersion:f.version,note:note.value.trim()},digest=JSON.stringify(payload);
   if(saved?.digest!==digest)saved={digest,requestId:crypto.randomUUID()};busy=true;for(const b of box.querySelectorAll('button'))b.disabled=true;status.textContent='جارٍ حفظ المتابعة…';
   try{await window.Auth.ensureSession();const token=window.Auth.getToken('accessToken'),base=window.WIZZCENTRAL_CONFIG?.STAFF_API_BASE_URL;if(!base||!token)throw Error('أعد تسجيل الدخول.');const r=await fetch(base+'/staff/dispatch-reviews/followup',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...payload,requestId:saved.requestId})}),data=await r.json();if(window.Auth.getToken('accessToken')!==token)throw Error('تغيرت الجلسة. حدّث الصفحة.');if(!r.ok)throw Error(errors[data.error]||'تعذر تأكيد الحفظ. أعد المحاولة بالمحتوى نفسه.');status.textContent='حُفظت المتابعة. لم يُنفذ إلغاء أو بحث بهذه الخطوة.';await refresh();}
   catch(e){status.textContent=e.message;}finally{busy=false;for(const b of box.querySelectorAll('button'))b.disabled=false;}
  });}box.append(status);return box;
 }};
})();
