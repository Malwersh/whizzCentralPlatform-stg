/* Driver vehicle/document reviews. All decisions use the scoped staff API. */
(function(){
'use strict';
const labels={APPROVED:'معتمدة',PENDING_REVIEW:'قيد المراجعة',REJECTED:'تحتاج إلى تصحيح',EXPIRED:'منتهية الصلاحية',REMOVED:'مؤرشفة'};
let dialog,content,driverId,data,busy=false,generation=0;
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function button(text,click,secondary=false){const n=el('button',text,secondary?'vehicle-secondary':'vehicle-primary');n.type='button';n.disabled=busy;n.onclick=click;return n;}
function field(label,type='text',value=''){const wrap=el('label',undefined,'vehicle-field'),input=el('input');wrap.append(el('span',label));input.type=type;input.value=value;wrap.append(input);return {wrap,input};}
function message(text){const n=content.querySelector('[role=alert]');if(n)n.textContent=text;}
function errorText(error){return ({VEHICLE_VERSION_CONFLICT:'تغيرت البيانات. أعد تحميل الملف قبل تسجيل القرار.',VEHICLE_DATA_INCOMPLETE:'أكمل نوع المركبة ورقم اللوحة أولًا.',DOCUMENT_EXPIRY_REQUIRED:'أدخل تاريخ انتهاء الوثيقة، أو حدّد أنها بلا تاريخ انتهاء ظاهر.',DOCUMENT_ALREADY_EXPIRED:'الوثيقة منتهية الصلاحية؛ اطلب تصحيحها.',DOCUMENT_OWNERSHIP_INVALID:'تعذر التحقق من ملكية الوثيقة.',VEHICLE_CHANGE_REQUIRES_OFFLINE:'أوقف السائق استقبال الطلبات وأكمل طلبه الجاري أولًا.',REGION_FORBIDDEN:'السائق خارج نطاق صلاحياتك.',PERMISSION_REQUIRED:'تحتاج إلى صلاحية مراجعة وثائق السائقين.',ACCOUNT_DOCUMENTS_INCOMPLETE:'راجع وثائق السائق واعتمد مركبة واحدة أولًا.',VEHICLE_REVIEW_REASON_REQUIRED:'اكتب سبب القرار.'})[error.code]||'تعذر تسجيل القرار. حدّث البيانات وحاول مجددًا.';}
async function load(){const mine=++generation;content.replaceChildren(el('p','جارٍ تحميل المركبات والوثائق…'));try{const result=await driverStaffApi('/staff/drivers/'+encodeURIComponent(driverId)+'/vehicles');if(mine!==generation||!dialog.open)return;data=result;render();}catch(error){if(mine!==generation)return;content.replaceChildren(el('p',errorText(error)),button('إعادة المحاولة',load));}}
async function save(body){if(busy)return;busy=true;content.querySelectorAll('button').forEach(n=>n.disabled=true);try{const result=await driverStaffApi('/staff/drivers/'+encodeURIComponent(driverId)+'/vehicles',{...body,expectedVersion:data.version});data=result;busy=false;render();}catch(error){busy=false;message(errorText(error));content.querySelectorAll('button').forEach(n=>n.disabled=false);}}
async function openDocument(url){try{const resolved=await AWSUtils.resolveDriverDocument(url);if(!resolved)throw Error('url');const u=new URL(resolved);if(u.protocol!=='https:')throw Error('url');window.open(u.href,'_blank','noopener,noreferrer');}catch(_){message('تعذر فتح الوثيقة. تحقق من صلاحيات الوصول ثم أعد المحاولة.');}}
function reviewForm(card,target){
 const area=el('div',undefined,'vehicle-review-form');
 const decision=el('select');for(const [value,text]of [['APPROVED','اعتماد الوثيقة'],['REJECTED','طلب تصحيح']]){const o=el('option',text);o.value=value;decision.append(o);}area.append(el('label','القرار'),decision);
 const expiry=field('آخر يوم لصلاحية الوثيقة (بتوقيت بغداد)','date');area.append(expiry.wrap);
 const noExpiry=field('لا يوجد تاريخ انتهاء ظاهر في الوثيقة','checkbox');area.append(noExpiry.wrap);
 noExpiry.input.onchange=()=>{expiry.input.disabled=noExpiry.input.checked;};
 const reason=el('textarea');reason.maxLength=1000;reason.rows=2;reason.placeholder='سبب القرار، وسبب عدم وجود تاريخ انتهاء إن اخترته';area.append(reason);
 const update=()=>{expiry.wrap.hidden=noExpiry.wrap.hidden=decision.value==='REJECTED';};decision.onchange=update;
 area.append(button('تسجيل قرار المراجعة',()=>{
  if(!reason.value.trim()){message('اكتب سبب القرار.');return;}
  if(decision.value==='APPROVED'&&!noExpiry.input.checked&&!expiry.input.value){message('أدخل تاريخ انتهاء الوثيقة أو حدّد عدم وجوده.');return;}
  save({...target,decision:decision.value,reason:reason.value.trim(),...(decision.value==='APPROVED'?{expiryDate:noExpiry.input.checked?null:expiry.input.value,noExpiry:noExpiry.input.checked}:{})});
 }));card.append(area);
}
function render(){
 content.replaceChildren();const info=el('div',undefined,'vehicle-summary');info.append(el('h3',data.profile.name||'ملف السائق'),el('p',[data.profile.governorateName,data.profile.workRegionName].filter(Boolean).join(' · ')),el('p',data.eligibility.eligible?'المركبة المختارة ووثائق السائق مؤهلة للعمل.':'يلزم إكمال المراجعة واختيار مركبة صالحة قبل استقبال الطلبات.'));content.append(info);
 const alert=el('p','');alert.role='alert';content.append(alert);
 const canReview=window.RBAC.staff?.permissions.includes('drivers.review');
 if(!data.initialized){
  const card=el('section',undefined,'vehicle-review-card');card.append(el('h3','مراجعة المركبة المسجلة سابقًا'),el('p','الموافقة القديمة على الحساب لا تعتمد الوثائق تلقائيًا. راجع الوثائق، ثم هيّئ سجل المركبات. يختار السائق مركبته بعد اكتمال المراجعة.'));
  const legacy=data.vehicles.find(v=>v.id==='legacy');
  if(legacy){const plate=field('رقم لوحة المركبة','text',legacy.plateNumber||'');plate.input.maxLength=40;card.append(plate.wrap);const type=el('select');for(const [value,label]of [['','اختر نوع المركبة'],['car','سيارة'],['motorcycle','دراجة نارية']]){const option=el('option',label);option.value=value;type.append(option);}type.value=['car','motorcycle'].includes(legacy.type)?legacy.type:'';card.append(type);if(legacy.registrationUrl)card.append(button('فتح السنوية الحالية',()=>openDocument(legacy.registrationUrl),true));
   if(canReview)card.append(button('تهيئة سجل المركبة للمراجعة',()=>save({action:'INITIALIZE',vehicle:{id:'legacy',type:type.value,plateNumber:plate.input.value,make:legacy.make||'',model:legacy.model||'',color:legacy.color||'',registrationUrl:legacy.registrationUrl}})));
  }else if(canReview)card.append(button('تهيئة سجل المركبات',()=>save({action:'INITIALIZE'})));
  content.append(card);
 }
 if(canReview){
  const account=el('section',undefined,'vehicle-review-card');account.append(el('h3','اعتماد الحساب'),el('p','اعتماد الحساب مستقل عن اعتماد المركبة. لا تتاح الموافقة قبل مراجعة الوثائق ومركبة واحدة على الأقل.'));
  const choice=el('select');for(const [value,label]of [['APPROVED','اعتماد الحساب'],['SUSPENDED','تعليق استقبال الطلبات'],['REJECTED','رفض الاعتماد']]){const option=el('option',label);option.value=value;choice.append(option);}const why=el('textarea');why.maxLength=1000;why.placeholder='سبب قرار الحساب';account.append(choice,why,button('تسجيل قرار الحساب',()=>{if(!why.value.trim()){message('اكتب سبب القرار.');return;}save({action:'REVIEW_ACCOUNT',decision:choice.value,reason:why.value.trim()});}));content.append(account);
 }
 content.append(el('h3','وثائق السائق'));
 for(const doc of data.documents){const card=el('section',undefined,'vehicle-review-card');card.append(el('h4',doc.kind==='nationalId'?'البطاقة الوطنية':'إجازة السوق / رخصة القيادة'),el('p',doc.uploaded?(labels[doc.status]||'قيد المراجعة'):'لم تُرفع الوثيقة'));if(doc.url)card.append(button('فتح الوثيقة',()=>openDocument(doc.url),true));if(doc.review?.reason)card.append(el('p','آخر قرار: '+doc.review.reason));if(doc.uploaded&&canReview&&data.initialized)reviewForm(card,{action:'REVIEW_DOCUMENT',documentKind:doc.kind});content.append(card);}
 content.append(el('h3','المركبات'));
 for(const v of data.vehicles){const card=el('section',undefined,'vehicle-review-card');card.append(el('h4',(v.type==='car'?'سيارة':'دراجة نارية')+' · '+(v.plateNumber||'اللوحة غير مسجلة')),el('p',(labels[v.effectiveStatus]||'قيد المراجعة')+(v.id===data.activeId?' · المختارة للعمل':'')));
  if(v.registrationUrl)card.append(button('فتح سنوية المركبة',()=>openDocument(v.registrationUrl),true));
  if(v.review?.reason)card.append(el('p','آخر قرار: '+v.review.reason));
  if(v.effectiveStatus!=='REMOVED'&&data.initialized&&canReview)reviewForm(card,{action:'REVIEW',vehicleId:v.id});content.append(card);
 }
 const history=el('details');history.append(el('summary','سجل الإجراءات والمراجعات'));
 for(const event of [...data.events].reverse()){history.append(el('p',[event.at,event.staff?'الإدارة':'السائق',({ADD:'إضافة مركبة',UPDATE:'تحديث المركبة',REMOVE:'إزالة المركبة',SELECT:'اختيار مركبة للعمل',INITIALIZE:'تهيئة السجل',REVIEW:'مراجعة سنوية',REVIEW_DOCUMENT:'مراجعة وثيقة',REVIEW_ACCOUNT:'مراجعة الحساب'})[event.action]||event.action,event.decision?labels[event.decision]:null,event.reason].filter(Boolean).join(' · ')));}content.append(history);
}
window.openDriverVehicleManagement=async function(id){
 driverId=id;
 if(!dialog){
  const style=el('style');style.textContent='.driver-vehicle-dialog{border:1px solid #dce3ef;border-radius:22px;width:min(850px,92vw);max-height:88vh;color:#00296b;padding:0}.driver-vehicle-dialog::backdrop{background:#001b4670}.vehicle-dialog-head{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #e9edf4;position:sticky;top:0;background:white;z-index:1}.vehicle-dialog-content{padding:20px}.vehicle-summary,.vehicle-review-card{background:#f6f8fc;border:1px solid #e2e8f2;border-radius:16px;padding:16px;margin-bottom:16px}.vehicle-primary,.vehicle-secondary{padding:10px 16px;border-radius:12px;margin:5px;border:1px solid #cad4e5;cursor:pointer;font:inherit}.vehicle-primary{background:#00296b;color:white}.vehicle-secondary{background:white;color:#00296b}.vehicle-review-form{display:grid;gap:10px;margin-top:14px;padding-top:14px;border-top:1px solid #dce3ef}.vehicle-field{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.vehicle-field input:not([type=checkbox]),.vehicle-review-form select,.vehicle-review-form textarea{padding:10px;border:1px solid #c9d3e3;border-radius:9px;font:inherit;max-width:100%;box-sizing:border-box}.vehicle-review-form textarea{width:100%}.vehicle-dialog-content [role=alert]{color:#b42318}.driver-vehicle-dialog button:disabled{opacity:.5;cursor:wait}';document.head.append(style);
  dialog=el('dialog',undefined,'driver-vehicle-dialog');dialog.dir='rtl';const head=el('header',undefined,'vehicle-dialog-head');head.append(el('h2','إدارة المركبات والوثائق'),button('إغلاق',()=>{if(!busy){generation++;dialog.close();if(typeof window.loadDriversData==='function')window.loadDriversData();}},true));content=el('div',undefined,'vehicle-dialog-content');dialog.append(head,content);dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else generation++;});document.body.append(dialog);
 }
 if(!dialog.open)dialog.showModal();await load();
};
})();
