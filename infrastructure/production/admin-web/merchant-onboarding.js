'use strict';
(()=>{
 let current=null,busy=false,canEdit=false;
 const $=id=>document.getElementById(id),message=text=>{$('message').textContent=text;};
 const errors={VERSION_OR_STATE_CONFLICT:'تغيرت الإعدادات أثناء عملك. احتفظ بتعديلاتك ثم حدّث البيانات قبل إعادة الحفظ.',NEW_AGREEMENT_VERSION_REQUIRED:'غيّرت نص الاتفاقية؛ أدخل رقم إصدار جديد لها.',AGREEMENT_NOT_READY:'استبدل نص الاتفاقية المبدئي بنص معتمد أولًا.',PARTNERSHIP_AGREEMENT_REQUIRED:'يجب اعتماد الاتفاقية قبل فتح التسجيل.',PERMISSION_REQUIRED:'ليست لديك صلاحية إدارة هذه الإعدادات.',INVALID_ONBOARDING_SETTINGS:'راجع الحقول المطلوبة وقيم الإعدادات.'};
 async function request(action,input){
  await window.Auth.ensureSession();
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{const r=await fetch('/staff/merchants/onboarding'+action,{method:input?'POST':'GET',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,cache:'no-store',signal:controller.signal});const data=await r.json();if(!r.ok)throw Error(errors[data.error]||(r.status===401?'انتهت جلسة الدخول. أعد تسجيل الدخول.':'تعذر إتمام العملية. أعد المحاولة.'));return data;}finally{clearTimeout(timer);}
 }
 function check(text,value,onchange){const label=document.createElement('label');label.className='check-row';const input=document.createElement('input');input.type='checkbox';input.checked=value;input.onchange=()=>onchange(input.checked);label.append(input,document.createTextNode(text));return label;}
 function render(){
  $('initial').hidden=!!current;$('editor').hidden=!current;if(!current)return;
  const values=current.values;$('terms-version').value=values.termsVersion;$('terms').value=values.termsTextAr;$('approved').checked=values.partnershipReady===true;$('version').textContent='الإصدار الحالي: '+current.version+' · تطبق التعديلات على طلبات التسجيل الجديدة.';
  $('types').replaceChildren();for(const type of values.types){const details=document.createElement('details');details.className='onboarding-type';const summary=document.createElement('summary');summary.textContent=type.labelAr+' · '+(type.registrationOpen?'التسجيل متاح':'التسجيل مغلق');details.append(summary);
   const label=document.createElement('label');label.textContent='اسم النشاط';const name=document.createElement('input');name.value=type.labelAr;name.required=true;name.maxLength=150;name.oninput=()=>type.labelAr=name.value;label.append(name);details.append(label);
   details.append(check('إتاحة التسجيل لهذا النشاط',type.registrationOpen,v=>type.registrationOpen=v));
   const documentField=type.fields.find(f=>f.id==='registrationCertificateAssetId');if(documentField)details.append(check('شهادة تسجيل النشاط مطلوبة',documentField.required,v=>{documentField.required=v;documentField.visible=true;}));
   const note=document.createElement('p');note.textContent='اسم الفرع والعنوان والهاتف والموقع مطلوبة دائمًا. '+(type.regions.length?'التسجيل مقيد بالمناطق المحددة مسبقًا.':'المناطق المتاحة تُحدد وفق مناطق الخدمة المنشورة.');details.append(note);$('types').append(details);
  }
 }
 async function load(){if(busy)return;busy=true;$('retry').disabled=true;message('جارٍ تحميل الإعدادات…');try{const result=await request('');current=result.current;canEdit=result.canEdit===true;render();$('add-type').disabled=!canEdit;$('save').disabled=!canEdit;$('initialize').disabled=!result.canEdit;message('');}catch(e){message(e.name==='AbortError'?'تأخر الاتصال. أعد المحاولة.':e.message);}finally{busy=false;$('retry').disabled=false;}}
 $('retry').onclick=load;
 $('initialize').onclick=async()=>{if(busy)return;busy=true;$('initialize').disabled=true;try{const r=await request('/initialize',{reason:'تهيئة أنشطة انضمام المطاعم في الإنتاج'});current=r.current;render();message('تم إنشاء الإعدادات. التسجيل ما زال مغلقًا.');}catch(e){message(e.message);}finally{busy=false;$('initialize').disabled=false;}};
 $('editor').onsubmit=async e=>{e.preventDefault();if(busy||!current)return;busy=true;$('save').disabled=true;const values=structuredClone(current.values);values.termsVersion=$('terms-version').value.trim();values.termsTextAr=$('terms').value.trim();values.partnershipReady=$('approved').checked;try{const r=await request('/save',{baseVersion:current.version,values,reason:$('reason').value.trim()});current=r.current;render();$('reason').value='';message('حُفظت الإعدادات بإصدار جديد.');}catch(e){message(e.message);}finally{busy=false;$('save').disabled=false;}};
 $('add-type').onclick=()=>{
  if(busy||!current||!canEdit)return;
  const ar=$('new-type-ar').value.trim(),en=$('new-type-en').value.trim(),model=$('new-type-model').value;
  if(!ar||!en){message('أدخل اسم النشاط بالعربية والإنجليزية.');return;}
  if(current.values.types.some(t=>t.labelAr.trim()===ar)){message('يوجد نشاط بهذا الاسم بالفعل.');return;}
  if(current.values.types.length>=30){message('بلغت الحد الأقصى للأنشطة.');return;}
  const template=current.values.types.find(t=>t.model===model);
  if(!template){message('نموذج النشاط غير متاح.');return;}
  const type=structuredClone(template);
  Object.assign(type,{id:'TYPE_'+crypto.randomUUID().replace(/-/g,'').toUpperCase(),labelAr:ar,labelEn:en,model,order:Math.max(...current.values.types.map(t=>t.order))+1,registrationOpen:false,regions:[]});
  current.values.termsVersion=$('terms-version').value.trim();current.values.termsTextAr=$('terms').value;current.values.partnershipReady=$('approved').checked;current.values.types.push(type);render();$('new-type-ar').value='';$('new-type-en').value='';message('أُضيف النشاط للتعديلات؛ احفظ الإعدادات لاعتماده.');
 };
 load();
})();
