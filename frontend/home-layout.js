(()=>{'use strict';
const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const copy=v=>structuredClone(v);
function canonical(s){if(!s||!s.source||!s.id)return s;return {...s,ranking:s.ranking??({rating:'rating',new:'new',curated:'manual'}[s.source]||'default'),layout:s.layout??'carousel',windowDays:s.windowDays??30,filters:{cuisineIds:[],brandIds:[],openNow:false,offersOnly:false,maxDistanceKm:null,minimumRating:null,...s.filters}};}
function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;}
const same=(a,b)=>JSON.stringify(stable(canonical(a)))===JSON.stringify(stable(canonical(b)));
const sources={region:'مطاعم المنطقة',rating:'الأعلى تقييمًا',new:'الجديد في ويز',curated:'مختارات الإدارة',favorites:'المحفوظة'};
const audiences={all:'الجميع',guest:'الضيوف',signedIn:'المسجلون'};
let catalog={version:0,cuisines:[],brands:[],profiles:{},canEdit:false},catalogDraft;
let state,options={regions:[],merchants:[]},busy=false,editing=null,returnFocus=null;
async function api(path,body){
 await window.Auth.ensureSession();const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
 try{const r=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:abort.signal});const data=await r.json();if(!r.ok)throw Error(r.status===409?'تغيّرت المسودة أو الصلاحيات. حدّث القائمة قبل المتابعة؛ بيانات المحرر لم تُفقد.':r.status===403?'لا تملك صلاحية هذا الإجراء.':'تعذر تأكيد العملية. حدّث القائمة للتحقق قبل إعادة المحاولة.');return data;}finally{clearTimeout(timer);}
}
function field(label,control){if(!['INPUT','SELECT','TEXTAREA'].includes(control.tagName)){const n=el('fieldset'),legend=el('legend',label);n.className='field-group';n.append(legend,control);return n;}const n=el('label',label);control.setAttribute('aria-label',label);n.append(control);return n;}
function action(label,fn,{disabled=false,secondary=true}={}){const b=el('button',label);b.type='button';b.className=secondary?'secondary':'';b.disabled=disabled||busy;b.onclick=fn;return b;}
function select(values,value,change){const n=el('select');for(const [id,label]of Object.entries(values)){const o=el('option',label);o.value=id;n.append(o);}n.value=value;n.onchange=()=>change(n.value);return n;}
function badge(text){const n=el('span',text);n.className='badge';return n;}
function changes(){
 const draft=state.draft,published=state.published?.sections||[],old=new Map(published.map(s=>[s.id,s])),next=new Map(draft.map(s=>[s.id,s]));const result=[];
 for(const s of draft){const before=old.get(s.id);if(!before)result.push(`إضافة «${s.title}»${s.enabled?'':' (متوقف)'}`);else if(!same(before,s))result.push(`${before.enabled&&!s.enabled?'إيقاف':!before.enabled&&s.enabled?'تفعيل':'تحديث'} «${s.title}»`);}
 for(const s of published)if(!next.has(s.id))result.push(`حذف «${s.title}»`);
 const common=draft.filter(s=>old.has(s.id)).map(s=>s.id),oldCommon=published.filter(s=>next.has(s.id)).map(s=>s.id);
 if(!same(common,oldCommon))result.push('تغيير ترتيب الأقسام');
 if(!state.published&&!result.length)result.push('اعتماد رئيسية دون أقسام إضافية؛ تبقى قائمة جميع المطاعم');
 return result;
}
function render(){
 const root=$('sections');root.replaceChildren();
 state.draft.forEach((s,i)=>{
  const card=el('article'),head=el('div');head.className='section-head';const identity=el('div'),title=el('h2',s.title);identity.append(el('small',`الترتيب ${i+1}`),title);head.append(identity);
  const published=state.published?.sections.find(x=>x.id===s.id);
  head.append(badge(!published?'مسودة جديدة':same(published,s)?'مطابق للمنشور':'تعديلات محفوظة'));
  card.append(head,el('p',`${sources[s.source]} · ${audiences[s.audience]} · حتى ${s.limit} مطاعم`));
  const status=el('p',s.enabled?'مفعّل في المسودة':'متوقف في المسودة');status.className='section-status';card.append(status);
  if(s.startAt||s.endAt)card.append(el('small',`بتوقيت بغداد: ${s.startAt?formatDate(s.startAt):'دون بداية محددة'} ← ${s.endAt?formatDate(s.endAt):'دون نهاية محددة'}`));
  const controls=el('div');controls.className='actions';
  controls.append(action(state.permissions.edit?'تعديل القسم':'عرض القسم',()=>openEditor(s.id)),action('معاينة القسم',()=>openPreview(s)));
  if(state.permissions.edit){controls.append(action(s.enabled?'إيقاف':'تفعيل',()=>saveChange(s.id,x=>{x.enabled=!x.enabled;},'حُفظ تغيير حالة القسم في المسودة.')));
   for(const [label,delta]of [['تحريك لأعلى',-1],['تحريك لأسفل',1]])controls.append(action(label,()=>move(s.id,delta),{disabled:i+delta<0||i+delta>=state.draft.length}));
   controls.append(action('حذف',()=>{if(confirm(`حذف «${s.title}» من المسودة؟ يبقى المنشور كما هو حتى نشر تغييرات الرئيسية.`))saveChange(s.id,null,'حُفظ حذف القسم في المسودة.');}));
  }
  card.append(controls);root.append(card);
 });
 if(!state.draft.length)root.append(el('p','لا توجد أقسام في المسودة. أضف قسمًا للبدء.'));
 $('add').disabled=busy||!state.permissions.edit||state.draft.length>=12;
 const delta=changes();$('change-count').textContent=delta.length?`${delta.length} تغييرات محفوظة تنتظر النشر`:'لا توجد تغييرات محفوظة تنتظر النشر';
 $('review').disabled=busy||!state.permissions.publish||!delta.length;
 $('rollback').disabled=busy||!state.permissions.publish||!state.history?.length;
 $('refresh').disabled=busy;
 $('catalog-open').disabled=busy||!catalog.canEdit;
 $('version').textContent=`${state.draft.length} أقسام في المسودة · النسخة المنشورة ${state.published?.revision??'لم تُنشر بعد'}`;
}
async function load(){[state,options,catalog]=await Promise.all([api('/staff/home-layout'),api('/staff/slideshow/options'),api('/staff/home-discovery/catalog')]);render();}
async function write(operation,extra,message){
 if(busy)return false;busy=true;render();lockEditor(true);$('message').textContent='جارٍ الحفظ…';
 try{const result=await api('/staff/home-layout/'+operation,{baseVersion:state.version,...extra});
  // Apply only the acknowledged draft; an unrelated read failure must not discard the editor.
  if(operation==='draft'){state={...state,version:result.version,draft:copy(extra.sections)};}
  else{state=await api('/staff/home-layout');}
  $('message').textContent=message;return true;
 }catch(error){$('message').textContent=error.name==='AbortError'?'تأخّر تأكيد الحفظ. حدّث القائمة للتحقق قبل تكرار العملية.':error.message;$('editor-message').textContent=$('message').textContent;return false;
 }finally{busy=false;lockEditor(false);render();}
}
async function saveChange(id,change,message){const sections=copy(state.draft);const i=sections.findIndex(s=>s.id===id);if(i<0)return;if(change)change(sections[i]);else sections.splice(i,1);await write('draft',{sections},message+' لم يتغير التطبيق بعد.');}
async function move(id,delta){const sections=copy(state.draft),i=sections.findIndex(s=>s.id===id),j=i+delta;if(i<0||j<0||j>=sections.length)return;[sections[i],sections[j]]=[sections[j],sections[i]];await write('draft',{sections},'حُفظ ترتيب الأقسام في المسودة؛ ينتظر نشر تغييرات الرئيسية.');}
function baghdadInput(value){return value?new Date(Date.parse(value)+3*3600000).toISOString().slice(0,16):'';}
function fromBaghdad(value){return value?new Date(value+':00+03:00').toISOString():null;}
function formatDate(value){return new Date(value).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'});}
function picker(items,selected,onChange){
 const box=el('div');box.className='picker';const search=el('input');search.type='search';search.placeholder='ابحث بالاسم';search.setAttribute('aria-label','البحث في الخيارات');const list=el('div');list.className='picker-list';
 const rows=[...items,...selected.filter(id=>!items.some(x=>x.id===id)).map(id=>({id,label:'اختيار سابق غير متاح حاليًا'}))];
 function draw(){list.replaceChildren();for(const item of rows.filter(x=>x.label.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()))){const label=el('label'),check=el('input');label.className='check-row';check.type='checkbox';check.checked=selected.includes(item.id);check.onchange=()=>{if(check.checked&&!selected.includes(item.id))selected.push(item.id);if(!check.checked)selected.splice(selected.indexOf(item.id),1);onChange();};label.append(check,el('span',item.label));list.append(label);}}
 search.oninput=draw;box.append(search,list);draw();return box;
}
function openEditor(id){
 if(busy)return;returnFocus=document.activeElement;const original=state.draft.find(s=>s.id===id);
 editing={original:original?copy(original):null,value:original?copy(original):{id:crypto.randomUUID(),title:'',source:'region',audience:'all',enabled:true,regionIds:[],merchantIds:[],limit:6,startAt:null,endAt:null}};
 $('editor-title').textContent=original?'تعديل القسم':'إضافة قسم جديد';$('editor-message').textContent='';drawEditor();$('editor').showModal();$('section-title').focus();
}
function drawEditor(){
 const s=editing.value,root=$('editor-fields');root.replaceChildren();const title=el('input');title.id='section-title';title.value=s.title;title.maxLength=80;title.required=true;title.oninput=()=>s.title=title.value;
 const count=el('input');count.type='number';count.min=1;count.max=12;count.required=true;count.value=s.limit;count.oninput=()=>s.limit=Number(count.value);
 root.append(field('عنوان القسم',title),field('مصدر المطاعم',select({region:'المطاعم المتاحة في المنطقة',curated:'مطاعم أختارها يدويًا',favorites:'المحفوظة لدى الزبون',...(['rating','new'].includes(s.source)?{[s.source]:sources[s.source]+' (قسم سابق)'}:{})},s.source,v=>{s.source=v;if(s.ranking==='manual'&&v!=='curated')s.ranking='default';drawEditor();})),field('الجمهور',select(audiences,s.audience,v=>s.audience=v)),field('عدد المطاعم',count));
 const rankingOptions={default:'الترتيب المعتاد',rating:'الأعلى تقييمًا',distance:'الأقرب لنقطة الزبون',new:'الأحدث انضمامًا',orders:'الأكثر طلبًا',...(s.source==='curated'?{manual:'ترتيبي اليدوي'}:{})};
 s.ranking??=({rating:'rating',new:'new',curated:'manual'}[s.source]||'default');s.layout??='carousel';s.windowDays??=30;
 s.filters={cuisineIds:[],brandIds:[],openNow:false,offersOnly:false,maxDistanceKm:null,minimumRating:null,...s.filters};
 root.append(field('ترتيب المطاعم',select(rankingOptions,s.ranking,v=>{s.ranking=v;drawEditor();})),field('طريقة العرض',select({carousel:'بطاقات أفقية',compactList:'قائمة مختصرة'},s.layout,v=>s.layout=v)));
 if(s.ranking==='orders')root.append(field('فترة الطلبات المكتملة',select({'7':'آخر ٧ أيام','30':'آخر ٣٠ يومًا'},String(s.windowDays),v=>s.windowDays=Number(v))));
 for(const [key,label]of [['openNow','المفتوح والمتاح للطلب فقط'],['offersOnly','مطاعم لها عروض مؤهلة للزبون']]){const input=el('input');input.type='checkbox';input.checked=s.filters[key];input.onchange=()=>s.filters[key]=input.checked;root.append(field(label,input));}
 for(const [key,label,list]of [['cuisineIds','نوع الطعام — عدم الاختيار يعني الجميع',catalog.cuisines],['brandIds','العلامة التجارية — عدم الاختيار يعني الجميع',catalog.brands]])root.append(field(label,picker(list,s.filters[key],()=>{})));
 for(const [key,label,min,max]of [['maxDistanceKm','نطاق القرب التقريبي (كم) — اختياري',0.1,100],['minimumRating','أقل تقييم موثّق — اختياري',1,5]]){const input=el('input');input.type='number';input.min=min;input.max=max;input.step='0.1';input.value=s.filters[key]??'';input.oninput=()=>s.filters[key]=input.value===''?null:Number(input.value);root.append(field(label,input));}
 const enabled=el('input');enabled.type='checkbox';enabled.checked=s.enabled;enabled.onchange=()=>s.enabled=enabled.checked;root.append(field('تفعيل القسم عند النشر',enabled));
 root.append(field('المناطق — عدم الاختيار يعني جميع مناطق الخدمة',picker(options.regions,s.regionIds,()=>{})));
 if(s.source==='curated'){
  const order=el('div');order.className='selected-order';
  function drawOrder(){order.replaceChildren();s.merchantIds.forEach((id,i)=>{const row=el('div');row.className='actions';row.append(el('span',options.merchants.find(x=>x.id===id)?.label||'مطعم غير متاح حاليًا'));
   for(const [label,delta]of [['رفع',-1],['خفض',1]])row.append(action(label,()=>{const j=i+delta;[s.merchantIds[i],s.merchantIds[j]]=[s.merchantIds[j],s.merchantIds[i]];drawOrder();},{disabled:i+delta<0||i+delta>=s.merchantIds.length}));order.append(row);});}
  root.append(field('اختر المطاعم',picker(options.merchants,s.merchantIds,drawOrder)),field('ترتيب المطاعم المختارة',order));drawOrder();
 }
 for(const [key,label]of [['startAt','بداية الظهور — بتوقيت بغداد'],['endAt','نهاية الظهور — بتوقيت بغداد']]){const input=el('input');input.type='datetime-local';input.value=baghdadInput(s[key]);input.onchange=()=>{try{input.setCustomValidity('');s[key]=fromBaghdad(input.value);}catch{input.setCustomValidity('أدخل تاريخًا صحيحًا');}};root.append(field(label,input));}
 $('editor-save').hidden=!state.permissions.edit;lockEditor(false);
}
function lockEditor(value){for(const input of $('editor').querySelectorAll('input,select,button'))input.disabled=value||(!state?.permissions.edit&&input.id!=='editor-close'&&input.id!=='editor-preview');}
function closeEditor(force=false){if(busy)return;if(!force&&editing&&!same(editing.original,editing.value)&&!confirm('تجاهل التغييرات غير المحفوظة لهذا القسم؟'))return;$('editor').close();editing=null;returnFocus?.focus();}
function previewSection(section,parent){
 const card=el('article');card.className='preview-card';card.append(el('h3',section.title||'عنوان القسم'),el('small',`الترتيب: ${{default:'المعتاد',manual:'يدوي',rating:'التقييم',new:'الأحدث',distance:'القرب',orders:'الطلبات المكتملة'}[section.ranking||'default']} · الشروط: ${section.filters?.cuisineIds?.length||0} تصنيفات طعام، ${section.filters?.brandIds?.length||0} علامات${section.filters?.offersOnly?' · عروض فقط':''}${section.filters?.openNow?' · مفتوح الآن':''}`),el('p',`${sources[section.source]} · ${section.enabled?'مفعّل':'متوقف'} · حتى ${section.limit} مطاعم`));
 const row=el('div');row.className='preview-row';const selected=section.source==='curated'?section.merchantIds.map(id=>options.merchants.find(x=>x.id===id)?.label||'مطعم غير متاح'):Array(Math.min(3,section.limit)).fill('نتيجة حسب منطقة الزبون');
 for(const name of selected.slice(0,section.limit)){const tile=el('div');tile.className='preview-tile';tile.append(el('span','صورة المطعم'),el('p',name));row.append(tile);}card.append(row);parent.append(card);
}
function openPreview(section){$('single-preview').replaceChildren();previewSection(section,$('single-preview'));$('preview-dialog').showModal();}
function review(){const list=$('changes');list.replaceChildren();for(const change of changes())list.append(el('li',change));$('preview').replaceChildren();for(const s of state.draft.filter(x=>x.enabled))previewSection(s,$('preview'));$('publish-message').textContent='';$('publication').showModal();}
$('add').onclick=()=>openEditor();$('editor-close').onclick=()=>closeEditor();$('editor').addEventListener('cancel',e=>{e.preventDefault();closeEditor();});
$('editor-preview').onclick=()=>openPreview(editing.value);$('preview-close').onclick=()=>$('preview-dialog').close();
$('editor-form').onsubmit=async event=>{event.preventDefault();if(!editing||busy)return;const s=copy(editing.value);s.title=s.title.trim();if(!s.title){$('section-title').focus();return;}if(s.source==='curated'&&!s.merchantIds.length){$('editor-message').textContent='اختر مطعمًا واحدًا على الأقل.';return;}if(s.startAt&&s.endAt&&Date.parse(s.startAt)>=Date.parse(s.endAt)){$('editor-message').textContent='نهاية الظهور يجب أن تكون بعد البداية.';return;}if(s.source!=='curated')s.merchantIds=[];const sections=copy(state.draft),i=sections.findIndex(x=>x.id===s.id);if(i<0)sections.push(s);else sections[i]=s;if(await write('draft',{sections},'حُفظت مسودة القسم؛ لم يتغير المنشور للزبائن.'))closeEditor(true);};
$('review').onclick=review;$('publication-close').onclick=()=>{if(!busy)$('publication').close();};$('publication').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('publish').onclick=async()=>{if(!state.permissions.publish||busy)return;$('publish').disabled=true;if(await write('publish',{},'نُشرت تغييرات الرئيسية المحفوظة؛ تظهر بعد تحديث التطبيق.'))$('publication').close();else $('publish-message').textContent=$('message').textContent;$('publish').disabled=false;};
$('rollback').onclick=async()=>{const previous=state.history?.at(-1);if(previous&&confirm('استعادة ترتيب الرئيسية المنشور سابقًا؟ المسودة الحالية تبقى محفوظة.'))await write('rollback',{revision:previous.revision},'استُعيد النشر السابق؛ المسودة الحالية محفوظة.');};
$('refresh').onclick=async()=>{if(busy)return;try{await load();$('message').textContent='حُدّثت القائمة.';}catch(e){$('message').textContent=e.message;}};
function catalogEditor(){
 const root=$('catalog-fields');root.replaceChildren();
 for(const [type,label]of [['cuisines','تصنيفات الطعام'],['brands','العلامات التجارية']]){
  const card=el('article');card.append(el('h3',label));const add=el('div');add.className='actions';const input=el('input');input.placeholder='اسم جديد';input.maxLength=70;input.setAttribute('aria-label',label+' — اسم جديد');add.append(input,action('إضافة',()=>{const value=input.value.trim();if(!value)return;if(catalogDraft[type].some(x=>x.label===value)){$('catalog-message').textContent='الاسم موجود بالفعل.';return;}catalogDraft[type].push({id:crypto.randomUUID(),label:value});catalogEditor();}));card.append(add);
  for(const row of catalogDraft[type]){const line=el('div');line.className='actions';const rename=el('input');rename.value=row.label;rename.maxLength=70;rename.setAttribute('aria-label','اسم '+row.label);rename.oninput=()=>row.label=rename.value;line.append(rename);const used=Object.values(catalogDraft.profiles).some(p=>type==='cuisines'?p.cuisineIds.includes(row.id):p.brandId===row.id);line.append(action(used?'مستخدم لدى مطعم':'حذف',()=>{catalogDraft[type]=catalogDraft[type].filter(x=>x.id!==row.id);catalogEditor();},{disabled:used}));card.append(line);}root.append(card);
 }
 const assignment=el('article');assignment.append(el('h3','ربط المطعم بالتصنيفات والعلامة'));
 const names=Object.fromEntries(options.merchants.map(x=>[x.id,x.label]));
 if(options.merchants.length){const selected=catalogDraft.selectedMerchant||options.merchants[0].id;catalogDraft.selectedMerchant=selected;const profile=catalogDraft.profiles[selected]??={cuisineIds:[],brandId:null};assignment.append(field('المطعم',select(names,selected,v=>{catalogDraft.selectedMerchant=v;catalogEditor();})),field('أنواع الطعام',picker(catalogDraft.cuisines,profile.cuisineIds,()=>{})),field('العلامة التجارية',select({'':'دون علامة',...Object.fromEntries(catalogDraft.brands.map(x=>[x.id,x.label]))},profile.brandId||'',v=>profile.brandId=v||null)));}root.append(assignment);
}
$('catalog-open').onclick=()=>{catalogDraft=copy(catalog);$('catalog-message').textContent='';catalogEditor();$('catalog-dialog').showModal();};
$('catalog-close').onclick=()=>{if(!busy)$('catalog-dialog').close();};
$('catalog-save').onclick=async()=>{if(busy)return;busy=true;$('catalog-save').disabled=true;try{await api('/staff/home-discovery/catalog',{baseVersion:catalog.version,cuisines:catalogDraft.cuisines,brands:catalogDraft.brands,profiles:catalogDraft.profiles});catalog=await api('/staff/home-discovery/catalog');$('catalog-dialog').close();$('message').textContent='حُفظت التصنيفات وربط المطاعم. تستخدمها الأقسام المطابقة بعد تحديث التطبيق.';}catch(e){$('catalog-message').textContent=e.message;}finally{busy=false;$('catalog-save').disabled=false;render();}};
$('catalog-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
load().catch(e=>$('message').textContent=e.message);
})();
