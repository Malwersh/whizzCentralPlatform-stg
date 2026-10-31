'use strict';
// A read-only projection of the selected branch record, not an ownership or eligibility calculator.
(()=>{
 const missing='غير مسجل';
 const text=v=>typeof v==='string'&&v.trim()&&!['N/A','Unknown Business','Unknown City','Address not available'].includes(v)?v.trim():'';
 const flag=v=>typeof v==='boolean'?v:null;
 const statuses={draft:'مسودة',pending:'بانتظار المراجعة',submitted:'مقدّم للمراجعة','under-review':'قيد المراجعة',under_review:'قيد المراجعة',needs_completion:'يحتاج استكمالًا',approved:'معتمد',rejected:'مرفوض',suspended:'معلّق',closing:'قيد الإغلاق',closed:'مغلق'};
 const types={restaurant:'مطعم',store:'متجر',grocery:'سوق / بقالة',market:'سوق',cafe:'مقهى',cloudkitchen:'مطبخ سحابي',pharmacy:'صيدلية',retail:'متجر'};
 function dateText(value){if(value==null||value==='')return missing;let date;if(typeof value==='number'&&Number.isSafeInteger(value)&&value>=1000000000000)date=new Date(value);else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value)){const day=new Date(value.slice(0,10)+'T00:00:00.000Z');if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==value.slice(0,10))return missing;date=new Date(value);}else return missing;if(!Number.isFinite(date.getTime()))return missing;return new Intl.DateTimeFormat('ar-IQ',{year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
 function normalize(r){
  const a=r.address&&typeof r.address==='object'?r.address:{},names=Array.isArray(r.regionNames)?r.regionNames:r.regionNames&&typeof r.regionNames==='object'?Object.values(r.regionNames):[];
  const region=[...new Set((names.length?names:[a.country||r.country,a.city||r.city,a.district||r.district,a.region||r.regionName]).map(text).filter(Boolean))].join(' ← ');
  const detail=text(a.fullAddress)||text(typeof r.address==='string'?r.address:'')||text(r.street);
  const rawStatus=text(r.status).toLowerCase()||text(r.reviewStatus).toLowerCase();
  return {id:text(r.businessId)||text(r.id),name:text(r.businessName)||text(r.name)||'نشاط بلا اسم مسجل',branchName:text(r.branchName),category:text(r.businessTypeLabelAr)||types[text(r.businessType).toLowerCase()]||'نوع غير مسجل',city:text(a.district||r.district)||text(a.city||r.city),address:[region,detail].filter(Boolean).join(' — ')||missing,region:region||missing,addressDetail:detail||missing,
   owner:text(r.ownerName)||text(r.owner)||text(r.contactName)||missing,email:text(r.email)||text(r.businessEmail)||missing,phone:text(r.phoneNumber)||text(r.phone)||missing,status:rawStatus||'unknown',isActive:flag(r.isActive),onboardingComplete:flag(r.onboardingComplete),acceptingOrders:flag(r.acceptingOrders),platformSuspended:flag(r.platformSuspended),ordersBlocked:flag(r.ordersBlocked),operatingStatus:text(r.operatingStatus),onlineStatus:text(r.onlineStatus),updatedAtRaw:r.updatedAt??null,lastStatusUpdate:r.lastStatusUpdate||r.updatedAt||null,joinDate:r.createdAt||r.dateCreated||null,modern:r.onboardingSchemaVersion!==undefined,organizationId:text(r.organizationId),brandId:text(r.brandId),agreementId:text(r.commercialAgreementId),agreementVersion:Number.isSafeInteger(r.commercialAgreementVersion)?r.commercialAgreementVersion:null,description:text(r.description)||text(r.businessDescription),avatar:text(r.businessPhotoUrl),fullData:r};
 }
 const el=(tag,textValue,cls)=>{const n=document.createElement(tag);if(textValue!==undefined)n.textContent=String(textValue);if(cls)n.className=cls;return n;};
 function add(host,label,value){const box=el('div',undefined,'merchant-detail-field');box.append(el('dt',label),el('dd',value||missing));host.append(box);}
 function badge(host,label,tone='neutral'){host.append(el('span',label,'merchant-branch-badge '+tone));}
 const boolText=(v,yes,no)=>v===true?yes:v===false?no:missing;
 function review(m){return statuses[m.status]||'حالة اعتماد غير مسجلة';}
 function readiness(m){return m.onboardingComplete!==null?boolText(m.onboardingComplete,'التجهيز مكتمل','التجهيز غير مكتمل'):m.modern?'حالة التجهيز غير مسجلة':'سجل سابق — اكتمال التجهيز غير مسجل';}
 function image(host,m){let url;try{url=new URL(m.avatar);if(url.protocol!=='https:')url=null;}catch{}if(url){const img=el('img');img.src=url.href;img.alt='صورة '+m.name;img.className='business-avatar';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.replaceWith(el('span',m.name.slice(0,1),'merchant-branch-placeholder'));host.append(img);}else host.append(el('span',m.name.slice(0,1),'merchant-branch-placeholder'));}
 function renderTable(items){const body=document.getElementById('merchantsTableBody');if(!body)return;body.replaceChildren();const table=body.closest('table');if(table)table.id='merchantBranchesTable';
  if(!items.length){const row=el('tr'),cell=el('td','لا توجد أنشطة أو فروع مطابقة.');cell.colSpan=9;row.append(cell);body.append(row);return;}
  for(const source of items){const m=normalize(source.fullData||source),row=el('tr');row.dataset.merchantRow=m.id;
   const cell=()=>{const n=el('td');row.append(n);return n;};
   const business=cell(),info=el('div',undefined,'business-info'),name=el('div',undefined,'business-details');image(info,m);name.append(el('h4',m.name),el('p',[m.category,m.branchName].filter(Boolean).join(' — ')),el('p',m.organizationId&&m.brandId?'روابط النشاط والعلامة مسجلة':'روابط النشاط والعلامة غير مكتملة'));info.append(name);business.append(info);
   const owner=cell();owner.append(el('div',m.owner),el('small',m.email));
   const approved=cell();badge(approved,review(m),m.status==='approved'?'good':m.status==='rejected'?'bad':'neutral');
   const ready=cell();badge(ready,readiness(m));ready.append(el('p',boolText(m.isActive,'إتاحة الظهور مفعّلة','إتاحة الظهور متوقفة')));if(m.platformSuspended)badge(ready,'معلّق من المنصة','bad');
   const receiving=cell();badge(receiving,boolText(m.acceptingOrders,'الاستقبال مفعّل','الاستقبال متوقف'));if(m.ordersBlocked)badge(receiving,'الطلبات ممنوعة من المنصة','bad');receiving.append(el('small','إعداد محفوظ؛ لا يثبت الاتصال أو فتح الساعات'));
   const phone=cell();phone.append(el('bdi',m.phone));phone.dir='ltr';
   const address=cell();address.append(el('div',m.address,'address-info'));
   cell().append(el('span',dateText(m.lastStatusUpdate)));
   const actions=el('div',undefined,'action-buttons');for(const [action,title,icon]of [['view-details','بيانات الفرع','fa-eye'],['view-products','منتجات الفرع','fa-box'],['toggle-status','التحكم بالنشاط والطلبات','fa-sliders-h']]){const b=el('button');b.type='button';b.className='btn-action';b.dataset.action=action;b.dataset.id=m.id;b.dataset.status=m.status;b.title=title;b.setAttribute('aria-label',title+' — '+m.name);b.append(el('i',undefined,'fas '+icon));actions.append(b);}cell().append(actions);body.append(row);
  }
 }
 function showDetails(source){const m=normalize(source.fullData||source),body=document.getElementById('merchantDetailsBody'),modal=document.getElementById('viewMerchantModal');if(!body||!modal)return;body.replaceChildren();document.getElementById('merchant-commercial-entry')?.remove();body.dir='rtl';body.append(el('h3',m.name),el('p','بيانات الفرع المسجلة وحالاته المستقلة'));
  const fields=el('dl',undefined,'merchant-branch-detail-grid');for(const [k,v]of [['النوع',m.category],['اسم الفرع',m.branchName],['المناطق المسجلة',m.region],['وصف العنوان',m.addressDetail],['هاتف تواصل الفرع',m.phone],['اسم المالك عند التسجيل',m.owner],['بريد التواصل عند التسجيل',m.email],['اعتماد البيانات',review(m)],['التجهيز',readiness(m)],['إتاحة الظهور',boolText(m.isActive,'مفعلة','متوقفة')],['إعداد استقبال الطلبات',boolText(m.acceptingOrders,'مفعّل','متوقف')],['تعليق المنصة',boolText(m.platformSuspended,'يوجد تعليق','لا يوجد تعليق مسجل')],['منع الطلبات من المنصة',boolText(m.ordersBlocked,'يوجد منع','لا يوجد منع مسجل')],['تاريخ إنشاء الفرع',dateText(m.joinDate)],['آخر تحديث للفرع',dateText(m.lastStatusUpdate)],['الوصف',m.description],['روابط النشاط والعلامة',m.organizationId&&m.brandId?'مسجلة':'غير مكتملة؛ لا تُستنتج من الهاتف أو الاسم'],['الاتفاقية التجارية',m.agreementId&&m.agreementVersion?'مرتبطة — إصدار '+m.agreementVersion:'لم تُربط اتفاقية تجارية معتمدة']])add(fields,k,v);body.append(fields);
  body.append(el('p','إعداد الاستقبال وإتاحة الظهور لا يثبتان الاتصال أو أن الفرع مفتوح حسب ساعات العمل. تفاصيل العمولة تُراجع من الاتفاقية التجارية المعتمدة.'));
  const commercial=el('button','الاتفاقية التجارية والعمولة','btn btn-primary');commercial.type='button';commercial.onclick=()=>{modal.style.display='none';window.commercialForBranch?.(m.id);};body.append(commercial);
  const changes=document.getElementById('merchant-changes-section');if(changes){const b=el('button','مراجعة طلبات تعديل الاسم والموقع','btn btn-secondary');b.type='button';b.onclick=()=>{modal.style.display='none';changes.open=true;changes.scrollIntoView();};body.append(b);}modal.style.display='flex';
 }
 window.MerchantBranchView={normalize,dateText,renderTable,showDetails};
})();
