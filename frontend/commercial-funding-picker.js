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
  const configured=Number.isSafeInteger(values.merchantNumerator)&&Number.isSafeInteger(values.denominator)&&values.merchantNumerator>0&&values.merchantNumerator<values.denominator;
  let touched=false;const original={merchantNumerator:values.merchantNumerator,denominator:values.denominator};
  const input=field('merchantPercent','حصة المتجر من مبلغ الخصم %',configured?percent(values.merchantNumerator,values.denominator):'');input.type='number';input.min='0.01';input.max='99.99';input.step='any';input.required=true;
  const preview=document.createElement('p');preview.setAttribute('role','note');host.append(preview);
  function read(){if(configured&&!touched)return original;const value=input.value.trim();if(!/^\d{1,2}(\.\d{1,2})?$/.test(value)||Number(value)<=0||Number(value)>=100)throw Error('أدخل حصة مشاركة أكبر من صفر وأقل من 100%، حتى منزلتين عشريتين.');return {merchantNumerator:Math.round(Number(value)*100),denominator:10000};}
  function update(){try{const v=read(),amount=Math.floor(1000*v.merchantNumerator/v.denominator);preview.textContent='حصة المنصة '+percent(v.denominator-v.merchantNumerator,v.denominator)+'%. عند خصم 1,000 د.ع: المتجر '+amount.toLocaleString('en')+' د.ع والمنصة '+(1000-amount).toLocaleString('en')+' د.ع.';}catch(e){preview.textContent=e.message;}}
  input.oninput=()=>{touched=true;update();};update();return read;
 }
 return {load:async businessId=>{try{return await load(businessId);}catch{throw Error('تعذر تحميل العروض كاملة. أعد المحاولة؛ لا توجد قائمة بديلة أو افتراضية.');}},share,percent};
})();
