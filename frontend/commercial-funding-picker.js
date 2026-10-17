'use strict';
// UI adapter only. Existing campaign writers, versions and financial validation remain authoritative.
window.CommercialFundingPicker=(()=>{
 const label=r=>[r.title||r.name||'',r.code?'الكود '+r.code:''].filter(Boolean).join(' — ');
 async function load(businessId){
  await window.Auth.ensureSession();
  const response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+'/staff/commercial?businessId='+encodeURIComponent(businessId)+'&view=funding-options',{method:'GET',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken')}});
  if(!response.ok)throw Error('COMMERCIAL_OPTIONS_UNAVAILABLE');
  const data=await response.json();if(data.businessId!==businessId||!Array.isArray(data.options))throw Error('COMMERCIAL_OPTIONS_UNAVAILABLE');return data.options;
 }
 const percent=(n,d)=>{const value=n/d*100;return Number.isInteger(value)?String(value):Number(value.toFixed(6)).toString();};
 function share(host,field,values){
  const configured=values.merchantNumerator!==undefined&&values.denominator!==undefined,original={merchantNumerator:values.merchantNumerator??0,denominator:values.denominator??10000};let touched=false;
  const mode=field('fundingMode','مَن يتحمل مبلغ الخصم؟',configured?(original.merchantNumerator===0?'PLATFORM':original.merchantNumerator===original.denominator?'MERCHANT':'SHARED'):'',[['','اختر مَن يتحمل الخصم'],['PLATFORM','المنصة بالكامل'],['MERCHANT','المتجر بالكامل'],['SHARED','مشاركة بين المتجر والمنصة']]);
  const input=field('merchantPercent','نسبة المتجر من مبلغ الخصم %',configured?percent(original.merchantNumerator,original.denominator):'');input.type='number';input.min='0';input.max='100';input.step='any';const preview=document.createElement('p');preview.setAttribute('role','note');host.append(preview);
  function read(){if(!mode.value||!configured&&!touched)throw Error('حدد مَن يتحمل الخصم ونسبة المشاركة.');if(!touched)return original;const value=input.value.trim();if(!/^\d{1,3}(\.\d{1,2})?$/.test(value)||Number(value)>100)throw Error('حصة المتجر من صفر إلى 100%، حتى منزلتين عشريتين.');return {merchantNumerator:Math.round(Number(value)*100),denominator:10000};}
  function update(){input.required=mode.value==='SHARED';input.parentElement.hidden=mode.value!=='SHARED';input.parentElement.style.display=mode.value==='SHARED'?'flex':'none';try{const v=read(),amount=Math.floor(1000*v.merchantNumerator/v.denominator);preview.textContent='مثال: عند خصم 1,000 د.ع يتحمل المتجر '+amount.toLocaleString('en')+' د.ع، والمنصة '+(1000-amount).toLocaleString('en')+' د.ع. هذه حصة من الخصم وليست عمولة المبيعات.';}catch(e){preview.textContent=e.message;}}
  mode.onchange=()=>{touched=true;if(mode.value==='PLATFORM')input.value='0';if(mode.value==='MERCHANT')input.value='100';if(mode.value==='SHARED'&&['0','100'].includes(input.value))input.value='';update();};input.oninput=()=>{touched=true;update();};update();return read;
 }
 function policies(host,items,campaigns,selected,field){
  const hidden=field('policies','',selected.join(','));hidden.parentElement.hidden=true;hidden.parentElement.style.display='none';hidden.type='hidden';hidden.required=false;
  const box=document.createElement('fieldset'),legend=document.createElement('legend');legend.textContent='الخصومات التي توافق الاتفاقية على تمويلها (اختياري)';box.append(legend);host.append(box);
  const options=items.filter(i=>i.draft.kind==='FUNDING'&&i.current?.status==='ACTIVE'&&i.draft.publishedVersion===i.current.version).map(i=>{const v=i.draft.values,c=campaigns.find(c=>c.id===v.campaignId&&c.source===v.source);return {id:i.draft.id,label:(c?.label||'عرض سابق — اسم الحملة غير متاح')+' — حصة المتجر '+percent(v.merchantNumerator,v.denominator)+'%',available:!!c&&c.version===v.campaignVersion&&c.fundingPolicyId===i.draft.id&&c.fundingPolicyVersion===i.current.version};});
  for(const option of options)if(!option.available)option.label+=' — تحتاج إعادة إعداد التمويل';
  for(const id of selected)if(!options.some(p=>p.id===id))options.push({id,label:'سياسة سابقة غير متاحة؛ أزل اختيارها أو أعد تحميل البيانات.',available:false});
  if(!options.length){const p=document.createElement('p');p.textContent='لا توجد سياسات تمويل منشورة لهذا الفرع. يمكنك ترك الاتفاقية دون مشاركة في الخصومات، أو إعداد السياسة من صفحة العروض والخصومات.';box.append(p);}
  for(const option of options){const wrap=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.includes(option.id);input.disabled=!option.available&&!input.checked;if(input.disabled)input.dataset.locked='true';input.dataset.policyId=option.id;wrap.append(input,document.createTextNode(' '+option.label));box.append(wrap);input.onchange=()=>{if(!option.available&&!input.checked){input.disabled=true;input.dataset.locked='true';}hidden.value=[...box.querySelectorAll('input:checked')].map(n=>n.dataset.policyId).join(',');};}
  return ()=>{const ids=hidden.value.split(',').filter(Boolean);if(ids.some(id=>!options.some(p=>p.id===id&&p.available)))throw Error('تعذر تأكيد بيانات بعض سياسات التمويل المختارة. أعد التحميل أو أزل السياسة غير المتاحة.');return ids;};
 }
 return {load:async businessId=>{try{return await load(businessId);}catch{throw Error('تعذر تحميل العروض كاملة. أعد المحاولة؛ لا توجد قائمة بديلة أو افتراضية.');}},share,policies,percent};
})();
