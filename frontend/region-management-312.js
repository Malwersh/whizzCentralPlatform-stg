/* Regions management: staff-authenticated drafts and durable, reviewed publication. */
(function(){
'use strict';
const LEVEL={0:'دولة',1:'محافظة',2:'قضاء',3:'منطقة'},STAGE={QUEUED:'بانتظار التجهيز',INDEXING:'تجهيز فهرس الموقع',VERIFYING:'التحقق من اكتمال الفهرس',CLEANUP:'نُشرت المنطقة؛ جارٍ تنظيف الفهرس السابق',PUBLISHED:'اكتمل النشر',ROLLBACK_INDEX:'استعادة الحالة السابقة',ROLLED_BACK:'استُعيدت الحالة السابقة',FAILED:'لم يكتمل النشر',CANCELLED:'أُلغي النشر واستُعيد السابق',MANUAL_REVIEW:'تحتاج مراجعة إدارية'};
const ERR={REGION_DELETE_HAS_CHILDREN:'انقل المناطق التابعة أو اختر حذفها ضمن الخطة.',REGION_HIERARCHY_INVALID:'تسلسل المنطقة وتوابعها يحتاج إلى تصحيح.',REGION_REFERENCES_EXIST:'عالج الارتباطات التشغيلية قبل اعتماد التغيير.',REGION_REFERENCE_CHECK_UNAVAILABLE:'تعذر فحص الارتباطات التشغيلية. أعد فحص الخطة.',REGION_RECLASSIFY_UNCHANGED:'اختر مستوى أو منطقة أب جديدة.',REAUTH_REQUIRED:'يلزم تسجيل دخول حديث لإكمال هذا الإجراء.',REGION_DRAFT_CONFIRMATION_MISSING:'تعذر تأكيد حفظ المسودة. بقي الرسم مفتوحًا؛ تحقق من قائمة المسودات قبل إعادة المحاولة.',REGION_VERSION_CONFLICT:'تغيرت المراجع أو المسودة. حدّث البيانات وراجع الرسم مجددًا.',REGION_PUBLICATION_IN_PROGRESS:'تجري عملية نشر حاليًا. انتظر اكتمالها قبل حفظ تغييرات أخرى.',REGION_GEOMETRY_REVIEW_REQUIRED:'تحتاج الحدود إلى تصحيح قبل النشر.',REGION_RECORD_CAPACITY:'السجل كبير لحفظه بأمان. بسّط الحدود أو قسّم الخطة دون تغيير نطاق الخدمة المقصود.',REGION_PLAN_CAPACITY:'حجم المسودات كبير للنشر دفعة واحدة. قسّم التغييرات إلى مجموعات أصغر.',REGION_CATALOG_CAPACITY:'حجم المناطق يتجاوز حد التحميل الآمن. يلزم تقسيم الكتالوج قبل التوسع.',REGION_INDEX_TOO_LARGE:'المنطقة أكبر من حد الفهرسة الآمن؛ راجع مستوى المنطقة وحدودها.',REGION_ROLLBACK_REVIEW_REQUIRED:'تغيرت البيانات خارج عملية النشر. يلزم مراجعة إدارية قبل استعادة السابق.',REGION_REASON_REQUIRED:'اكتب سببًا واضحًا من خمسة أحرف على الأقل.',PERMISSION_REQUIRED:'لا تتوفر صلاحية هذا الإجراء.',REGION_FORBIDDEN:'المنطقة خارج نطاق صلاحياتك.',REGION_READERS_NOT_READY:'خدمة المناطق قيد التجهيز. لا يمكن النشر الآن.',REGION_MANAGEMENT_UNAVAILABLE:'خدمة إدارة المناطق غير متاحة الآن.',REGION_OPERATOR_CHANGED:'تغير اعتماد الموظف أو صلاحياته؛ راجع الخطة من حساب مخوّل.',REGION_SOURCE_CHANGED:'تغيرت المناطق أثناء التجهيز؛ أعد المراجعة بعد استعادة الحالة السابقة.',REGION_PUBLICATION_BATCH_LIMIT:'الخطة أكبر من حد النشر الذري الآمن. قسّم التغييرات إلى دفعات أصغر.',PARENT_MOVE_REVIEW_REQUIRED:'نقل منطقة قائمة إلى أب آخر يحتاج مراجعة أثر مستقلة.',LEVEL_IMMUTABLE:'لا يمكن تغيير مستوى منطقة قائمة.'};
const dto=r=>Object.fromEntries(['regionId','name','name_ar','level','parent_id','is_active','geometry','service_config','delivery_config','archived'].filter(k=>r[k]!==undefined).map(k=>[k,structuredClone(r[k])]));
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls)=>{const b=node('button',text,cls);b.type='button';b.onclick=fn;return b;};
const errorText=e=>ERR[e.code]||e.message||'تعذر إكمال العملية. حاول مجددًا.';
async function api(path,body){await window.Auth.ensureSession();const response=await fetch(window.WIZZCENTRAL_CONFIG.STAFF_API_BASE_URL+'/staff/regions/manage'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+window.Auth.getToken('accessToken'),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok)throw Object.assign(Error(data.error||'تعذر تحميل المناطق'),{code:data.error,details:data.details});return data;}
class App{
 constructor(root){this.root=root;this.catalog=null;this.selected=new Set();this.audit=new Map();this.worker=new Worker(new URL('../region-geometry-worker-312.js?v=323',window.location.href));this.requests=new Map();this.token=0;this.worker.onmessage=e=>{const resolve=this.requests.get(e.data.token);if(resolve){this.requests.delete(e.data.token);resolve(e.data.result);}};this.worker.onerror=()=>{this.worker.terminate();this.worker=null;for(const resolve of this.requests.values())resolve(null);this.requests.clear();};this.polls=new Set();this.publishRequestId=null;this.planReady=false;this.planGeneration=0;this.build();}
 async validate(region,regions,preview){
  if(this.worker){
   const result=await new Promise(resolve=>{const token=++this.token;this.requests.set(token,resolve);this.worker.postMessage({token,region,regions,preview});});
   if(result)return result;
  }
  return preview?RegionGeometry312.preview(region,regions,preview.sketch):RegionGeometry312.validate(region,regions);
 }
 build(){this.root.replaceChildren();this.root.classList.add('region-app');const tools=node('div',undefined,'region-toolbar');tools.append(node('h2','إدارة مناطق الخدمة'));this.add=button('إضافة منطقة',()=>this.openRegionModal(), 'region-primary');tools.append(this.add,button('تحديث',()=>this.load()));this.root.append(tools);this.alert=node('div','', 'region-alert');this.alert.setAttribute('role','alert');this.root.append(this.alert);this.summary=node('p','جارٍ تحميل المناطق…','region-note');this.root.append(this.summary);
  const grid=node('div',undefined,'region-grid'),list=node('section',undefined,'region-card'),mapCard=node('section',undefined,'region-card');grid.append(list,mapCard);this.root.append(grid);
  const filters=node('div',undefined,'region-filters');this.search=node('input');this.search.placeholder='ابحث عن منطقة أو محافظة';this.search.oninput=()=>this.renderRows();this.level=node('select');for(const [value,label]of [['','كل المستويات'],...Object.entries(LEVEL)]){const o=node('option',label);o.value=value;this.level.append(o);}this.level.onchange=()=>this.renderRows();filters.append(this.search,this.level);list.append(filters);const wrap=node('div',undefined,'region-table-wrap'),table=node('table'),head=node('thead'),row=node('tr');for(const name of ['المنطقة','الحالة','الحدود','الإجراء'])row.append(node('th',name));head.append(row);this.rows=node('tbody');table.append(head,this.rows);wrap.append(table);list.append(wrap);
  mapCard.append(node('h3','الحدود المنشورة'));const map=node('div');map.id='region-overview-map';mapCard.append(map,node('p','اضغط «عرض» لمراجعة الحدود المنشورة. افتح المسودة لمراجعة رسمك قبل النشر.','region-note'));
  this.plan=node('section',undefined,'region-card');this.root.append(this.plan);this.jobs=node('section',undefined,'region-card');this.root.append(this.jobs);
  if(window.L){this.map=L.map(map).setView([31.96,44.36],9);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(this.map);this.mapLayers=L.featureGroup().addTo(this.map);}
 }
 notice(text){this.alert.textContent=text;}
 async load(){this.notice('');try{this.catalog=await api('');this.add.disabled=!this.catalog.permissions.edit;this.audit.clear();this.renderRows();this.renderMap();this.renderPlan();this.renderJobs();this.checkRows();}catch(e){this.notice(errorText(e));this.summary.textContent='تعذر تحميل المناطق.';}}
 renderRows(){if(!this.catalog)return;const q=this.search.value.trim().toLowerCase(),level=this.level.value;this.rows.replaceChildren();const items=this.catalog.regions.filter(r=>(!level||String(r.level)===level)&&(!q||[r.name,r.name_ar,this.catalog.regions.find(p=>p.regionId===r.parent_id)?.name_ar].filter(Boolean).join(' ').toLowerCase().includes(q)));for(const r of items){const tr=node('tr'),name=node('td');name.append(node('strong',r.name_ar||r.name),node('div',LEVEL[r.level],'region-note'));tr.append(name);const state=node('td');state.append(node('span',r._regionPublication?'قيد النشر':r.archived?'مؤرشفة':r.is_active&&r.effective?.effective_is_active===1?'متاحة':'متوقفة','region-pill'));tr.append(state);const quality=node('td'),a=this.audit.get(r.regionId);quality.textContent=a?(a.valid?'سليمة':'تحتاج مراجعة'):'جارٍ الفحص…';quality.dataset.quality=r.regionId;if(a&&!a.valid){quality.className='region-warning';quality.title=a.errors.map(e=>e.message).join('\n');}tr.append(quality);const actions=node('td');actions.className='region-actions';actions.append(button('عرض',()=>this.focus(r)));const edit=button('تعديل',()=>this.openRegionModal(r.regionId));edit.disabled=!r.editable||!this.catalog.permissions.edit||!!r._regionPublication;actions.append(edit);for(const [label,operation] of [['تغيير التصنيف','reclassify'],['حذف المنطقة','delete']]){const action=button(label,()=>this.openRegionModal(r.regionId,operation));action.disabled=edit.disabled;actions.append(action);}if(this.catalog.permissions.history&&r.editable)actions.append(button('السجل',()=>this.history(r)));tr.append(actions);this.rows.append(tr);}if(!items.length){const tr=node('tr'),td=node('td','لا توجد مناطق تطابق البحث.','region-empty');td.colSpan=4;tr.append(td);this.rows.append(tr);}}
 async checkRows(){const c=this.catalog;for(const r of c.regions){const report=await this.validate(r,c.regions);if(c!==this.catalog)return;this.audit.set(r.regionId,report);const cell=this.rows.querySelector('[data-quality="'+r.regionId+'"]');if(cell){cell.textContent=report.valid?'سليمة':'تحتاج مراجعة';cell.classList.toggle('region-warning',!report.valid);cell.title=report.errors.map(e=>e.message).join('\n');}}this.summary.textContent=c.regions.length+' منطقة · '+[...this.audit.values()].filter(r=>!r.valid).length+' تحتاج مراجعة حدود. هذا فحص هندسي، ولا يصحح الحدود نيابة عن الإدارة.';}
 renderMap(){if(!this.mapLayers||!this.catalog)return;this.mapLayers.clearLayers();for(const r of this.catalog.regions.filter(r=>r.level===3&&r.geometry))try{const layer=L.geoJSON(r.geometry,{style:{color:'#00296b',weight:1.5,fillOpacity:.045}});layer.bindTooltip(node('span',r.name_ar||r.name));layer.addTo(this.mapLayers);}catch{}}
 focus(r){if(!this.map||!r.geometry)return;this.focusLayer?.remove();this.focusLayer=L.geoJSON(r.geometry,{style:{color:this.audit.get(r.regionId)?.valid===false?'#d32f2f':'#00296b',weight:3,fillOpacity:.15}}).addTo(this.map);this.map.fitBounds(this.focusLayer.getBounds(),{padding:[18,18],maxZoom:15});}
 async renderPlan(){const c=this.catalog;if(!c)return;this.planReady=false;this.publishRequestId=null;this.plan.replaceChildren(node('h3','مسوداتي ومراجعة النشر'));const drafts=c.drafts.filter(d=>d.status==='DRAFT');if(!drafts.length){this.plan.append(node('p','لا توجد مسودات تنتظر النشر.','region-empty'));return;}
  this.selected=new Set([...this.selected].filter(id=>drafts.some(d=>d.region.regionId===id)));if(!this.selected.size)for(const d of drafts)this.selected.add(d.region.regionId);
  for(const draft of drafts){const row=node('div',undefined,'region-draft'),check=node('input');check.type='checkbox';check.checked=this.selected.has(draft.region.regionId);check.setAttribute('aria-label','اختيار '+draft.region.name_ar+' للنشر');check.onchange=()=>{if(check.checked)this.selected.add(draft.region.regionId);else this.selected.delete(draft.region.regionId);this.checkPlan();};row.append(check,node('span',(draft.operation==='delete'?'حذف · ':draft.operation==='reclassify'?'تغيير التصنيف · ':'')+draft.region.name_ar),button('فتح المسودة',()=>this.openRegionModal(draft.region.regionId)));const discard=button('حذف المسودة',()=>this.discard(draft));discard.disabled=!c.permissions.edit;row.append(discard);this.plan.append(row);}
  this.planState=node('div','جارٍ التحقق من المسودات المختارة…','region-publication-state');this.planState.setAttribute('role','status');this.reason=node('textarea');this.reason.className='region-publication-reason';this.reason.placeholder='سبب النشر وملخص مراجعة الحدود';this.reason.rows=2;this.reason.maxLength=1000;this.reason.oninput=()=>this.publishButton.disabled=!this.planReady||this.reason.value.trim().length<5||!c.permissions.publish;this.publishButton=button('نشر المسودات المختارة',()=>this.publish(),'region-primary');this.publishButton.disabled=true;this.plan.append(this.planState,this.reason,node('p','عند تحديث حدود منطقة قائمة، يتوقف استقبال طلبات جديدة فيها مؤقتًا أثناء التجهيز. الطلبات الجارية تبقى محفوظة. لا تُفعّل المنطقة حتى اكتمال الفهرس والتحقق منه.','region-note'),this.publishButton);await this.checkPlan();
 }
 async checkPlan(){if(!this.planState)return;const generation=++this.planGeneration;this.planReady=false;this.publishButton.disabled=true;this.publishRequestId=null;const drafts=this.catalog.drafts.filter(d=>d.status==='DRAFT'&&this.selected.has(d.region.regionId));if(!drafts.length){this.planState.textContent='اختر مسودة واحدة على الأقل.';return;}this.planState.textContent='جارٍ التحقق من الخطة على الخادم…';try{const report=await api('/validate-plan',{catalogDigest:this.catalog.digest,drafts:drafts.map(d=>({regionId:d.region.regionId,version:d.version}))});if(this.planGeneration!==generation)return;this.planReady=report.valid;this.planState.textContent=report.valid?'التغييرات المختارة جاهزة لطلب النشر.':report.errors.map(e=>(e.message||ERR[e.code]||e.code)+(e.regionName?' «'+e.regionName+'»':'')).join('\n');this.publishButton.disabled=!report.valid||this.reason.value.trim().length<5||!this.catalog.permissions.publish;}catch(e){if(this.planGeneration===generation)this.planState.textContent=errorText(e);}}
 async history(region){const dialog=node('dialog',undefined,'region-editor'),wrap=node('div');wrap.style.padding='20px';wrap.append(node('h2','سجل '+(region.name_ar||region.name)),button('إغلاق',()=>dialog.close()));const body=node('div','جارٍ تحميل السجل…');wrap.append(body);dialog.append(wrap);document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();try{const result=await api('/history/'+encodeURIComponent(region.regionId));body.replaceChildren();if(!result.items.length)body.append(node('p','لا توجد عمليات نشر مسجلة لهذه المنطقة بعد.'));for(const item of result.items){const card=node('section');card.style.cssText='padding:14px 0;border-bottom:1px solid #e2e8f0';card.append(node('strong',new Date(item.at).toLocaleString('ar-IQ',{timeZone:'Asia/Baghdad'})),node('p',item.actorName),node('p',item.reason));if(item.before&&item.after)card.append(node('p','الحالة: '+(item.before.is_active?'متاحة':'متوقفة')+' ← '+(item.after.is_active?'متاحة':'متوقفة')+(item.before.geometryDigest!==item.after.geometryDigest?' · عُدلت الحدود':'')));body.append(card);}}catch(e){body.textContent=errorText(e);}}
 async discard(d){if(!confirm('حذف المسودة فقط؟ لن تتغير المنطقة المنشورة.'))return;try{await api('/discard',{regionId:d.region.regionId,expectedDraftVersion:d.version,reason:'حذف المسودة دون تغيير المنطقة المنشورة'});await this.load();}catch(e){this.notice(errorText(e));}}
 async publish(){if(!this.planReady)return;const chosen=this.catalog.drafts.filter(d=>d.status==='DRAFT'&&this.selected.has(d.region.regionId));const deleting=chosen.filter(d=>d.operation==='delete');const prompt=deleting.length?'تأكيد الحذف النهائي للمناطق التالية من جداول التغطية؟ '+deleting.map(d=>d.region.name_ar).join('، '):'نشر المسودات المختارة بعد المراجعة؟ قد تتوقف الطلبات الجديدة في المناطق أثناء تجهيز الحدود.';if(!confirm(prompt))return;this.publishButton.disabled=true;this.publishRequestId??=crypto.randomUUID().replace(/-/g,'');try{const result=await api('/publish',{drafts:chosen.map(d=>({regionId:d.region.regionId,version:d.version})),catalogDigest:this.catalog.digest,requestId:this.publishRequestId,reason:this.reason.value.trim()});await this.load();this.watchJob(result.job.jobId);}catch(e){this.notice(errorText(e));this.publishButton.disabled=false;}}
 renderJobs(){this.jobs.replaceChildren(node('h3','متابعة نشر المناطق'));const items=this.catalog?.jobs||[];if(!items.length){this.jobs.append(node('p','لا توجد عمليات نشر مسجلة لحسابك.','region-empty'));return;}for(const j of items)this.paintJob(j);}
 paintJob(j){let row=this.jobs.querySelector('[data-job="'+j.jobId+'"]');if(!row){row=node('div',undefined,'region-job');row.dataset.job=j.jobId;this.jobs.append(row);}row.replaceChildren(node('strong',STAGE[j.stage]||STAGE[j.status]||'قيد المعالجة'));row.append(node('div','المناطق: '+j.regionIds.map(id=>this.catalog.regions.find(r=>r.regionId===id)?.name_ar||this.catalog.drafts.find(d=>d.region.regionId===id)?.region.name_ar||'منطقة جديدة').join('، ')));if(j.indexedCells)row.append(node('div','خلايا الفهرس المجهزة: '+j.indexedCells));if(j.error)row.append(node('p',ERR[j.error]||'تعذر إكمال النشر. راجع المراجع والحدود قبل إعادة المحاولة.','region-warning'));if(['QUEUED','BUILDING'].includes(j.status)){row.append(button('إلغاء النشر واستعادة السابق',()=>this.cancel(j)));this.watchJob(j.jobId);}else if(j.status==='ROLLING_BACK'||j.cleanupPending)this.watchJob(j.jobId);}
 async cancel(j){if(!confirm('إلغاء هذه العملية واستعادة المنطقة السابقة؟'))return;try{await api('/cancel',{jobId:j.jobId,reason:'إلغاء النشر بناء على مراجعة الإدارة'});this.watchJob(j.jobId);await this.load();}catch(e){this.notice(errorText(e));}}
 watchJob(id){if(this.polls.has(id))return;this.polls.add(id);const poll=async()=>{try{const j=await api('/jobs/'+encodeURIComponent(id));this.paintJob(j);if(['FAILED','CANCELLED','REVIEW_REQUIRED'].includes(j.status)||j.status==='PUBLISHED'&&!j.cleanupPending){this.polls.delete(id);await this.load();return;}}catch(e){this.notice(errorText(e));}setTimeout(poll,3500);};setTimeout(poll,700);}
 openRegionModal(id,operation){if(!this.catalog?.permissions.edit)return;this.closeRegionModal();const original=this.catalog.regions.find(r=>r.regionId===id),draft=this.catalog.drafts.find(d=>d.region.regionId===id);if(draft?.status==='QUEUED'){this.notice('هذه المسودة قيد النشر. تابع العملية قبل تعديلها.');return;}operation??=draft?.status==='DRAFT'?draft.operation:undefined;
  if(operation==='delete'){if(original)this.openDeleteModal(original,draft);return;}
  const region=dto(draft?.status==='DRAFT'?draft.region:original||{regionId:'R'+crypto.randomUUID().replace(/-/g,''),name:'',name_ar:'',level:3,parent_id:null,is_active:true,service_config:{delivery:true,pickup:false,dineIn:false},delivery_config:{estimated_time_minutes:30},geometry:null});if(region.level===0)region.parent_id=null;
  const dialog=node('dialog',undefined,'region-editor');
  this.dialog=dialog;
  const editor=this.editor={dialog,region,original,draftVersion:draft?.version??0,operation,fields:{},generation:0,mapMode:null,structureValid:false};
  const h=node('div',undefined,'region-editor-head');
  const heading=node('h2',original?'تعديل حدود المنطقة وبياناتها':'إضافة منطقة جديدة');
  h.append(heading,button('إغلاق',()=>this.closeRegionModal()));
  const body=node('div',undefined,'region-editor-body'),fields=node('div'),mapArea=node('div');
  body.append(fields,mapArea);
  dialog.append(h,body);
  let fieldTarget=fields;
  const section=(title,hint,collapsed=false)=>{
   const box=node(collapsed?'details':'section',undefined,'region-field-section');
   box.append(node(collapsed?'summary':'h3',title));
   if(hint)box.append(node('p',hint,'region-field-help'));
   fields.append(box);
   fieldTarget=box;
   return box;
  };
  const input=(key,label,type='text',value='')=>{
   const wrap=node('label'),control=node(type==='select'?'select':type==='textarea'?'textarea':'input');
   wrap.append(node('span',label),control);
   if(type!=='select'&&type!=='textarea')control.type=type;
   control.value=value;
   control.oninput=()=>this.checkEditor();
   fieldTarget.append(wrap);
   editor.fields[key]=control;
   return control;
  };
  section('١ · تعريف المنطقة','ابدأ بالدولة، ثم المحافظة، ثم القضاء، ثم الناحية أو مركز القضاء.');
  input('name_ar','اسم المنطقة بالعربية','text',region.name_ar);
  input('name','اسم المنطقة بالإنجليزية','text',region.name);
  const classification=button('تغيير التصنيف',()=>{
   if(editor.saving)return;
   editor.operation='reclassify';
   updateClassification();
   lev.focus();
   this.drawContext();
   this.checkEditor();
  });
  const classificationControl=node('div',undefined,'region-field-help');
  classificationControl.append(classification);
  fieldTarget.append(classificationControl);
  const lev=input('level','المستوى','select');
  for(const [value,label]of Object.entries(LEVEL)){
   const option=node('option',value==='3'?'ناحية أو منطقة':label);
   option.value=value;
   lev.append(option);
  }
  lev.value=region.level;
  const parent=input('parent_id','المنطقة الأب','select');
  const populate=()=>{
   const current=parent.value||region.parent_id;
   const level=Number(lev.value);
   const placeholder=node('option','اختر المنطقة الأب');
   placeholder.value='';
   parent.replaceChildren(placeholder);
   const rows=this.prospective();
   for(const r of rows.filter(r=>r.regionId!==region.regionId&&Number(r.level)===level-1&&!r.archived)){
    const owner=rows.find(p=>p.regionId===r.parent_id);
    const choice=node('option',r.name_ar+' · '+(owner?.name_ar||LEVEL[r.level]));
    choice.value=r.regionId;
    parent.append(choice);
   }
   parent.value=Array.from(parent.options).some(o=>o.value===current)?current:'';
   parent.disabled=lev.disabled||level===0;
  };
  lev.onchange=()=>{if(editor.follow)this.finishBoundaryFollow(editor);populate();this.drawContext();this.checkEditor();};
  parent.onchange=()=>{
   if(editor.follow)this.finishBoundaryFollow(editor);
   this.drawContext(!editor.region.geometry&&!editor.mapMode);
   this.checkEditor();
  };
  const checkbox=(key,label,value)=>{
   const wrap=node('label',undefined,'region-check'),check=node('input');
   check.type='checkbox';
   check.checked=value;
   check.onchange=()=>this.checkEditor();
   wrap.append(check,node('span',label));
   fieldTarget.append(wrap);
   editor.fields[key]=check;
  };
  const service=section('٢ · إتاحة الخدمة','لن تتغير الخدمة عند حفظ المسودة؛ التغيير يبدأ بعد نجاح النشر.');
  checkbox('is_active','إتاحة المنطقة بعد اكتمال النشر',region.is_active&&!region.archived);
  checkbox('delivery','السماح بخدمة التوصيل',region.service_config?.delivery===true);
  for(const key of ['pickup','dineIn']){
   const control=node('input');
   control.type='checkbox';
   control.checked=region.service_config?.[key]===true;
   control.hidden=true;
   editor.fields[key]=control;
  }
  const advanced=section('إعدادات المنطقة المتقدمة','هذه قيم محفوظة للمنطقة، وليست سياسة التسعير الحديثة. لا تضع رسومًا هنا بقصد تغيير سعر الطلب؛ رسوم التوصيل وحدودها تُضبط من سياسة التسعير. اترك القيم فارغة إن لم تكن مطلوبة.',true);
  input('estimated_time_minutes','وقت التوصيل التقديري بالدقائق','number',region.delivery_config?.estimated_time_minutes??30);
  input('base_fee','رسوم التوصيل المحلية (د.ع)','number',region.delivery_config?.base_fee??'');
  input('minimum_order','الحد الأدنى لقيمة الطلب محليًا (د.ع)','number',region.delivery_config?.minimum_order??'');
  const updateClassification=()=>{
   const reclassifying=editor.operation==='reclassify';
   classificationControl.hidden=!original||reclassifying;
   if(reclassifying)heading.textContent='تغيير تصنيف المنطقة';
   lev.disabled=Boolean(original)&&!reclassifying;
   service.hidden=advanced.hidden=reclassifying;
   populate();
  };
  updateClassification();
  section('٣ · توثيق الحدود','اذكر مصدر الحدود أو سبب تعديلها، بخمسة أحرف على الأقل.');
  input('reason','سبب التعديل أو مصدر الحدود','textarea',draft?.reason||'');
  mapArea.append(node('p','الأخضر يبيّن المقطع المطابق لحدّ منطقة مجاورة. الكحلي لبقية الرسم السليم، والأحمر لموضع الخطأ. المتقطع يبيّن حدّ المنطقة الأب.','region-note'));const map=node('div');map.id='region-editor-map';mapArea.append(map);const controls=node('div',undefined,'region-editor-controls');controls.append(button('مسح الرسم',()=>{this.editor.drawn?.clearLayers();this.editor.region.geometry=null;this.checkEditor();}),button('استيراد GeoJSON',()=>file.click()));this.editor.addPart=node('input');this.editor.addPart.type='checkbox';this.editor.addPart.onchange=()=>this.previewDrawing();const addPart=node('label',undefined,'region-check');addPart.append(this.editor.addPart,node('span','إضافة جزء آخر بدل استبدال الرسم'));controls.append(addPart);
  editor.snap=node('input');editor.snap.type='checkbox';editor.snap.checked=true;
  const snapLabel=node('label',undefined,'region-check');snapLabel.title='عند اقتراب المؤشر من نقطة في حدّ مجاور أو حدّ المنطقة الأب، يُثبتها الرسم في إحداثياتها.';snapLabel.append(editor.snap,node('span','التقاط نقاط الحدود'));
  controls.append(snapLabel);
  const file=node('input');file.type='file';file.accept='.json,.geojson,application/geo+json';file.hidden=true;file.onchange=()=>this.importGeometry(file.files[0]);controls.append(file);this.editor.showHighlights=button('عرض موضع التنبيه',()=>{const e=this.editor,bounds=e.highlights?.getBounds();if(bounds?.isValid())e.map.fitBounds(bounds,{padding:[35,35],maxZoom:17});});this.editor.showHighlights.hidden=true;controls.append(this.editor.showHighlights);mapArea.append(controls);this.editor.status=node('div','ارسم حدود المنطقة لبدء الفحص.','region-validation');this.editor.status.setAttribute('role','status');mapArea.append(this.editor.status);
  this.buildBoundaryFollow(editor,controls,map);
  const footer=node('div',undefined,'region-editor-footer');this.editor.saveHint=node('p','جارٍ التحقق من الحدود…');this.editor.saveHint.setAttribute('role','status');footer.append(this.editor.saveHint);this.editor.save=button('حفظ المسودة',()=>this.saveEditor(),'region-primary');this.editor.save.disabled=true;footer.append(button('إلغاء',()=>this.closeRegionModal()),this.editor.save);dialog.append(footer);document.body.append(dialog);dialog.addEventListener('close',()=>{if(this.dialog===dialog)this.closeRegionModal();});dialog.showModal();setTimeout(()=>this.editor&&this.initEditorMap(),40);
 }
 openDeleteModal(region,draft){
  const dialog=node('dialog',undefined,'region-editor');
  this.dialog=dialog;
  const body=node('div',undefined,'region-card'),status=node('p','جارٍ فحص أثر الحذف…','region-validation');
  status.setAttribute('role','status');
  const label=node('label','سبب طلب الحذف'),why=node('textarea');
  why.maxLength=1000;
  if(draft?.operation==='delete')why.value=draft.reason||'';
  label.append(why);
  const close=button('إلغاء',()=>this.closeRegionModal());
  const submit=button('حفظ مسودة الحذف',async()=>{
   submit.disabled=true;
   try{
    const result=await api('/draft',{region:{regionId:region.regionId},operation:'delete',catalogDigest:this.catalog.digest,expectedDraftVersion:draft?.version??0,reason:why.value.trim()});
    if(result.draft?.operation!=='delete'||result.draft.status!=='DRAFT'||result.draft.region?.regionId!==region.regionId)throw Object.assign(Error(),{code:'REGION_DRAFT_CONFIRMATION_MISSING'});
    if(this.dialog!==dialog)return;
    this.closeRegionModal();
    await this.load();
    this.notice('حُفظت مسودة حذف «'+region.name_ar+'». راجع الخطة قبل اعتماد الحذف.');
   }catch(error){status.textContent=errorText(error);submit.disabled=why.value.trim().length<5;}
  },'region-primary');
  submit.disabled=why.value.trim().length<5;
  why.oninput=()=>submit.disabled=why.value.trim().length<5;
  body.append(node('h2','حذف '+region.name_ar),node('p','أكمل مراجعة الخطة لاعتماد حذف المنطقة وحدودها وفهارسها من جداول التغطية.'),status,label,close,submit);
  dialog.append(body);
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{if(this.dialog===dialog)this.closeRegionModal();});
  dialog.showModal();
  api('/validate',{region:{regionId:region.regionId},operation:'delete'}).then(report=>{
   status.textContent=report.valid?'يمكن مراجعة مسودة الحذف واعتمادها.':report.errors.map(issue=>(issue.message||ERR[issue.code]||issue.code)+(issue.regionName?' «'+issue.regionName+'»':'')).join('\n');
  }).catch(error=>status.textContent=errorText(error));
 }
 closeRegionModal(){const e=this.editor,d=this.dialog;this.editor=null;this.dialog=null;if(e){clearTimeout(e.timer);clearTimeout(e.previewTimer);e.map?.remove();}if(d){if(d.open)d.close();d.remove();}}
 prospective(){const map=new Map(this.catalog.regions.map(r=>[r.regionId,r]));for(const d of this.catalog.drafts.filter(d=>d.status==='DRAFT'))if(d.operation==='delete')map.delete(d.region.regionId);else map.set(d.region.regionId,d.region);return [...map.values()];}
 readEditor(){
  const e=this.editor,r=structuredClone(e.region),f=e.fields;
  r.name=f.name.value.trim();
  r.name_ar=f.name_ar.value.trim();
  r.level=Number(f.level.value);
  r.parent_id=r.level===0?null:f.parent_id.value||null;
  if(e.operation==='reclassify'){
   r.is_active=[true,1,'1','true'].includes(r.is_active);
   return r;
  }
  r.is_active=f.is_active.checked;
  r.archived=false;
  r.service_config=Object.fromEntries(['delivery','pickup','dineIn'].map(k=>[k,f[k].checked]));
  r.delivery_config={};
  for(const k of ['estimated_time_minutes','base_fee','minimum_order'])if(f[k].value!=='')r.delivery_config[k]=Number(f[k].value);
  return r;
 }
 draftBlocker(e,region,structural){
  if(e.mapMode==='follow')return 'اعتمد المقطع من لوحة الخريطة لمتابعة الرسم.';
  if(e.mapMode==='draw'&&e.usedBoundary)return 'أضف بقية نقاط الحدود، ثم اضغط «إغلاق المضلع».';
  if(e.mapMode==='draw')return 'أغلق المضلع لإكمال الرسم.';
  if(e.mapMode)return 'اضغط «اعتماد الرسم» بجانب أدوات الخريطة لتأكيد التعديل.';
  if(!region.name_ar||!region.name)return 'أدخل اسم المنطقة بالعربية والإنجليزية.';
  if(region.level>0&&!region.parent_id)return 'اختر المنطقة الأب.';
  if(!structural.valid)return structural.errors[0]?.message||'صحّح بنية الرسم قبل حفظ المسودة.';
  if(e.operation==='reclassify'&&region.level===Number(e.original.level)&&region.parent_id===(e.original.parent_id||null))return 'اختر مستوى جديدًا أو منطقة أب جديدة.';
  if(e.fields.reason.value.trim().length<5)return 'اكتب سبب التعديل أو مصدر الحدود من خمسة أحرف على الأقل.';
  return '';
 }
 checkEditor(){
  const e=this.editor;
  if(!e)return;
  clearTimeout(e.timer);
  const generation=++e.generation;
  e.save.disabled=true;
  if(e.mapMode==='draw'){this.previewDrawing();return;}
  if(e.mapMode==='edit'||e.mapMode==='delete'){this.previewEditedGeometry(e);return;}
  if(e.mapMode)return;
  e.saveHint.textContent='جارٍ التحقق من الحدود…';
  e.status.className='region-validation';
  e.status.textContent='جارٍ التحقق من الحدود…';
  e.timer=setTimeout(()=>this.validateEditor(e,generation),140);
 }
 async validateEditor(e,generation,preview){
  if(e!==this.editor||generation!==e.generation)return;
  const region=this.readEditor();
  if(preview?.geometry!==undefined)region.geometry=preview.geometry;
  const refs=this.prospective().filter(r=>r.regionId!==region.regionId);
  if(e.original&&e.operation!=='reclassify')refs.push(e.original);
  let report;
  try{report=await this.validate(region,refs,{sketch:preview?.sketch});}catch{
   report={valid:false,errors:[{message:'تعذر فحص الحدود. أعد المحاولة.'}]};
  }
  if(e!==this.editor||generation!==e.generation)return;
  e.status.className='region-validation '+(report.valid?'valid':'invalid');
  const issues=report.errors.map(issue=>{
   const name=issue.regionName||refs.find(r=>r.regionId===issue.regionId)?.name_ar;
   return issue.message+(name?' «'+name+'»':'');
  });
  e.status.textContent=report.valid?(preview?.sketch?'الخط المرسوم سليم حتى الآن. أغلق المضلع لفحص المساحة كاملة.':'الحدود سليمة هندسيًا وفق المراجع الحالية.'):issues.join('\n');
  if(e.mapMode==='draw'&&e.usedBoundary){
   e.followUI.drawIssue.textContent=report.valid?'':(preview?.closing?'عند إغلاق المضلع: ':'')+(issues[0]||'');
   e.followUI.drawIssue.hidden=report.valid;
  }
  this.paintEditorValidation(e,report);
  if(e.mapMode)return;
  const structural=RegionGeometry312.inspect(region.geometry);
  const blocker=this.draftBlocker(e,region,structural);
  e.structureValid=structural.valid;
  e.save.disabled=!!blocker||e.saving===true;
  e.save.textContent=blocker?'حفظ المسودة':report.valid?'حفظ المسودة الجاهزة':'حفظ مسودة للتصحيح';
  e.saveHint.textContent=blocker||(report.valid?'يمكنك حفظ المسودة ومراجعتها قبل النشر.':'يمكنك حفظ المسودة الآن. صحّح التنبيهات قبل النشر.');
 }
 paintEditorValidation(e,report){
  const navy='#00296b',green='#15803d',red='#d32f2f';
  const hasSegments=Array.isArray(report.boundary)&&report.boundary.length>0;
  const baseColor=report.valid||hasSegments?navy:'#718096';
  if(e.mapMode!=='draw')e.drawn?.eachLayer(layer=>layer.setStyle?.({color:baseColor,fillColor:baseColor,weight:3}));
  e.map?.getContainer().classList.toggle('region-sketch-preview',e.mapMode==='draw'&&hasSegments);
  e.boundaryLines?.clearLayers();
  e.highlights?.clearLayers();
  for(const part of report.boundary||[]){
   if(e.mapMode!=='draw'&&!part.invalid&&!part.shared)continue;
   const points=part.coordinates.map(([longitude,latitude])=>[latitude,longitude]);
   L.polyline(points,{interactive:false,color:part.invalid?red:part.shared?green:navy,weight:part.shared?6:4,smoothFactor:0}).addTo(part.invalid?e.highlights:e.boundaryLines);
  }
  for(const feature of report.highlights||[]){
   try{L.geoJSON(feature,{interactive:false,style:{color:'#d32f2f',fillColor:'#d32f2f',fillOpacity:.24,weight:3},pointToLayer:(_,point)=>L.circleMarker(point,{interactive:false,radius:6,color:'#d32f2f',fillOpacity:1})}).addTo(e.highlights);}catch{}
  }
  e.showHighlights.hidden=!e.highlights?.getBounds().isValid();
 }
 editorPolygons(e){
  const polygons=[];
  e.drawn.eachLayer(layer=>{
   const geometry=layer.toGeoJSON(false).geometry;
   if(geometry.type==='Polygon')polygons.push(geometry.coordinates);
   if(geometry.type==='MultiPolygon')polygons.push(...geometry.coordinates);
  });
  return polygons;
 }
 polygonGeometry(polygons){
  if(!polygons.length)return null;
  return polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons};
 }
 previewEditedGeometry(e){
  this.queueGeometryPreview(()=>({geometry:this.polygonGeometry(this.editorPolygons(e))}));
 }
 queueGeometryPreview(getGeometry){
  const e=this.editor;
  if(!e?.mapMode)return;
  e.nextPreview=getGeometry;
  if(e.previewTimer||e.previewRunning)return;
  e.previewTimer=setTimeout(async()=>{
   e.previewTimer=null;
   if(e!==this.editor||!e.mapMode||!e.nextPreview)return;
   const next=e.nextPreview;
   e.nextPreview=null;
   e.previewRunning=true;
   try{
    const input=next();
    if(input!==undefined)await this.validateEditor(e,e.generation,input);
   }finally{
    e.previewRunning=false;
    if(e===this.editor&&e.mapMode&&e.nextPreview)this.queueGeometryPreview(e.nextPreview);
   }
  },100);
 }
 buildBoundaryFollow(e,controls,map){
  const panel=node('section',undefined,'region-follow-panel');
  panel.setAttribute('aria-label','اتباع حد منشور');
  const label=node('label','الحدود التي ستتبعها');
  const select=node('select');
  select.onchange=()=>this.showBoundarySource(e);
  label.append(select);
  const status=node('p',undefined,'region-note');
  status.setAttribute('role','status');
  const actions=node('div',undefined,'region-editor-controls');
  const alternate=button('عرض المسار الآخر',()=>{
   e.follow.direction=1-e.follow.direction;
   this.paintBoundarySelection(e);
  });
  const confirm=button('اعتماد المقطع ومتابعة الرسم',()=>this.confirmBoundarySelection(e),'region-primary');
  const replace=button('استبدال مقطع من الحد الحالي',()=>this.startBoundaryReplacement(e));
  const reselect=button('تغيير المقطع الحالي',()=>this.startBoundaryReplacement(e));
  actions.append(confirm,alternate,replace,reselect,button('إلغاء اختيار الحد',()=>this.finishBoundaryFollow(e)));
  panel.append(label,status,actions);
  panel.hidden=true;
  const drawing=node('section',undefined,'region-follow-panel');
  drawing.setAttribute('aria-label','إكمال رسم المنطقة');
  drawing.append(node('p','تابع بإضافة نقاط بعد نهاية الخط المنسوخ، ثم أغلق المضلع.','region-note'));
  const drawIssue=node('p',undefined,'region-follow-issue');
  drawIssue.hidden=true;
  drawIssue.setAttribute('role','status');
  drawing.append(drawIssue);
  const close=button('إغلاق المضلع',()=>this.polygonDrawing(e)?.completeShape(),'region-primary');
  drawing.append(close);
  drawing.hidden=true;
  map.append(panel,drawing);
  const editingControls=[...controls.querySelectorAll('button,input')];
  const hint=node('p','', 'region-note');
  hint.id='region-follow-hint';
  controls.after(hint);
  e.followUI={panel,label,select,status,hint,alternate,confirm,replace,reselect,drawing,drawIssue,close,editingControls,open:button('اتبع حدًا منشورًا',()=>this.startBoundaryFollow(e))};
  e.followUI.open.setAttribute('aria-describedby',hint.id);
  e.followUI.open.disabled=true;
  controls.prepend(e.followUI.open);
 }
 boundarySources(e){
  const level=Number(e.fields.level.value),parentId=e.fields.parent_id.value;
  const available=this.catalog.regions.filter(r=>r.regionId!==e.region.regionId&&!r.archived&&
   Object.hasOwn(LEVEL,Number(r.level))&&['Polygon','MultiPolygon'].includes(r.geometry?.type));
  const peers=available.filter(r=>Number(r.level)===level);
  const parent=available.find(r=>r.regionId===parentId&&Number(r.level)===level-1);
  const references=available.filter(r=>Number(r.level)!==level&&r!==parent);
  references.sort((a,b)=>Number(a.level)-Number(b.level));
  return peers.concat(parent?[parent]:[],references);
 }
 updateBoundaryFollow(e){
  if(!e?.followUI)return;
  const sources=this.boundarySources(e),available=sources.length>0;
  e.followUI.open.disabled=!available||!e.map||!!e.follow||!!e.saving||!!(e.mapMode&&e.mapMode!=='draw');
  let hint='';
  if(!available){
   hint='ارسم أول حد وانشره ليصبح متاحًا للنسخ في الرسوم التالية.';
  }else if(e.region.geometry&&!e.mapMode){
   hint='لتعديل جزء من الرسم الحالي، اختر «اتبع حدًا منشورًا» ثم «استبدال مقطع من الحد الحالي».';
  }else if(Number(e.fields.level.value)>0&&!e.fields.parent_id.value){
   hint='يمكنك اتباع حد منشور من أي مستوى. اختر المنطقة الأب لتحديد نطاق الرسم.';
  }
  e.followUI.hint.textContent=hint;
  e.followUI.hint.hidden=!hint||!!e.follow;
 }
 polygonDrawing(e){
  return e.drawControl?._toolbars?.draw?._modes?.polygon?.handler;
 }
 updateBoundaryDrawing(e){
  const {drawing,close}=e.followUI;
  drawing.hidden=e.mapMode!=='draw'||!e.usedBoundary;
  close.disabled=(this.polygonDrawing(e)?._poly?.getLatLngs().length||0)<3;
 }
 startBoundaryFollow(e){
  const sources=this.boundarySources(e),handler=this.polygonDrawing(e);
  if(e!==this.editor||e.saving||e.followUI.open.disabled||!handler||!sources.length)return;
  const resume=e.mapMode==='draw';
  const sketch=resume?(handler._poly?.getLatLngs()||[]).slice():[];
  const usedBoundary=e.usedBoundary;
  if(resume)handler.disable();
  const editingDisabled=e.followUI.editingControls.map(control=>control.disabled);
  e.follow={sources,resume,sketch,editingDisabled,usedBoundary};
  e.mapMode='follow';
  clearTimeout(e.timer);
  ++e.generation;
  e.save.disabled=true;
  e.saveHint.textContent=this.draftBlocker(e,e.region,{valid:false});
  e.drawControl.getContainer().hidden=true;
  e.followUI.editingControls.forEach(control=>control.disabled=true);
  const {panel,select}=e.followUI;
  select.replaceChildren();
  const groups=new Map();
  const level=Number(e.fields.level.value);
  const referenceLabels=['حدود الدول','حدود المحافظات','حدود الأقضية','حدود النواحي والمناطق'];
  for(const source of sources){
   const sourceLevel=Number(source.level);
   const groupName=sourceLevel===level?'المستوى نفسه':
    source.regionId===e.fields.parent_id.value?'المنطقة الأب':referenceLabels[sourceLevel];
   if(!groups.has(groupName)){
    const group=node('optgroup');
    group.label=groupName;
    groups.set(groupName,group);
    select.append(group);
   }
   const parent=this.catalog.regions.find(r=>r.regionId===source.parent_id);
   const parentName=parent?.name_ar||parent?.name;
   const option=node('option',(source.name_ar||source.name)+(parentName?' · '+parentName:''));
   option.value=source.regionId;
   groups.get(groupName).append(option);
  }
  panel.hidden=false;
  e.followUI.label.hidden=false;
  this.updateBoundaryFollow(e);
  this.showBoundarySource(e);
  select.focus();
 }
 showBoundarySource(e){
  const state=e.follow;
  const source=state.sources.find(r=>r.regionId===e.followUI.select.value);
  if(!source)return;
  this.showFollowGeometry(e,source.geometry);
 }
 startBoundaryReplacement(e){
  if(!e.follow||e.follow.resume||!e.region.geometry)return;
  if(!RegionGeometry312.inspect(e.region.geometry).valid){
   e.followUI.status.textContent='صحّح بنية المضلع الحالي لتحديد المقطع المراد استبداله.';
   return;
  }
  e.follow.replacement={};
  e.followUI.label.hidden=true;
  this.showFollowGeometry(e,e.region.geometry);
 }
 showFollowGeometry(e,geometry){
  const state=e.follow;
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  state.rings=polygons.flatMap((polygon,polygonIndex)=>polygon.map((ring,ringIndex)=>({
   polygonIndex,ringIndex,points:ring.slice(0,-1).map(([lng,lat])=>L.latLng(lat,lng)),
  })));
  state.start=state.end=null;
  state.paths=null;
  state.direction=0;
  e.followSource.clearLayers();
  const outline=L.geoJSON(geometry,{interactive:false,smoothFactor:0,style:{color:'#456797',weight:4,fill:false}}).addTo(e.followSource);
  const target=state.replacement?.target;
  const bounds=target?L.latLngBounds(target.path.points):outline.getBounds();
  this.paintBoundarySelection(e);
  if(bounds.isValid()){
   const {x:width,y:height}=e.map.getSize();
   const panel=e.followUI.panel;
   const rightPad=state.replacement&&width>=620?panel.offsetWidth+24:30;
   const topPad=Math.min(height*0.45,Math.max(160,panel.offsetHeight+24));
   e.map.stop().fitBounds(bounds,{paddingTopLeft:[30,topPad],paddingBottomRight:[rightPad,30],maxZoom:16,animate:false});
  }
 }
 nearestBoundaryVertex(e,point){
  const state=e.follow,pixel=e.map.latLngToLayerPoint(point);
  let nearest=null,distance=20;
  state.rings.forEach(({points},ringIndex)=>{
   if(state.start&&!state.end&&state.start.ring!==ringIndex)return;
   points.forEach((vertex,index)=>{
    const d=e.map.latLngToLayerPoint(vertex).distanceTo(pixel);
    if(d<=distance){distance=d;nearest={ring:ringIndex,index,vertex};}
   });
  });
  return nearest;
 }
 chooseBoundaryVertex(e,point){
  const state=e.follow,chosen=this.nearestBoundaryVertex(e,point);
  if(!chosen){
   e.followUI.status.textContent='انقر قرب نقطة على الحد المظلّل. كبّر الخريطة للوصول إلى نقطة أدق.';
   return;
  }
  if(!state.start||state.end){
   state.start=chosen;
   state.end=null;
   state.paths=null;
   this.paintBoundarySelection(e);
   return;
  }
  if(chosen.index===state.start.index){
   e.followUI.status.textContent='اختر نقطة نهاية مختلفة على الحد نفسه.';
   return;
  }
  state.end=chosen;
  const ring=state.rings[chosen.ring].points;
  const paths=[1,-1].map(direction=>{
   const points=this.walkBoundary(ring,state.start.index,chosen.index,direction);
   const length=points.slice(1).reduce((sum,point,i)=>sum+e.map.distance(points[i],point),0);
   return {points,length,direction};
  });
  state.paths=paths.sort((a,b)=>a.length-b.length);
  state.direction=0;
  this.paintBoundarySelection(e);
 }
 walkBoundary(ring,start,end,direction){
  const points=[ring[start]];
  for(let index=start;index!==end;){
   index=(index+direction+ring.length)%ring.length;
   points.push(ring[index]);
  }
  return points;
 }
 confirmBoundarySelection(e){
  const state=e.follow;
  const path=state?.paths?.[state.direction];
  if(!path)return;
  if(!state.replacement){this.finishBoundaryFollow(e,true);return;}
  if(!state.replacement.target){
   state.replacement.target={ring:state.rings[state.start.ring],start:state.start.index,end:state.end.index,path};
   e.followUI.label.hidden=false;
   this.showBoundarySource(e);
   e.followUI.select.focus();
   return;
  }
  if(!state.candidate)return;
  e.region.geometry=state.candidate;
  this.finishBoundaryFollow(e);
  this.renderEditorGeometry();
  this.checkEditor();
 }
 replacementGeometry(e,target,source){
  const {ring,start,end,path}=target;
  const from=ring.points[start],to=ring.points[end];
  const distance=(a,b)=>e.map.distance(a,b);
  const forward=distance(from,source[0])+distance(to,source.at(-1));
  const backward=distance(from,source.at(-1))+distance(to,source[0]);
  const segment=backward<forward?[...source].reverse():source;
  const rest=this.walkBoundary(ring.points,end,start,path.direction);
  const points=[from,...segment,...rest].filter((point,index,all)=>index===0||!point.equals(all[index-1],0));
  const coordinates=(path.direction===1?points:points.reverse()).map(point=>[point.lng,point.lat]);
  const geometry=structuredClone(e.region.geometry);
  const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
  polygons[ring.polygonIndex][ring.ringIndex]=coordinates;
  return geometry;
 }
 async previewBoundaryReplacement(e,state,path){
  const geometry=this.replacementGeometry(e,state.replacement.target,path.points);
  const region={...this.readEditor(),geometry};
  const reference=this.prospective().filter(row=>row.regionId!==region.regionId);
  if(e.original&&e.operation!=='reclassify')reference.push(e.original);
  let report;
  try{report=await this.validate(region,reference,{sketch:undefined});}
  catch{report={valid:false,errors:[{message:'تعذر فحص المقطع المقترح. أعد اختياره.'}]};}
  if(e!==this.editor||e.follow!==state||state.paths?.[state.direction]!==path)return;
  const {confirm,status}=e.followUI;
  this.paintEditorValidation(e,report);
  if(!report.valid){
   status.textContent=report.errors.map(issue=>issue.message).join('\n');
   if(!RegionGeometry312.inspect(geometry).valid)return;
   confirm.textContent='اعتماد المقطع للتصحيح';
  }else{
   status.textContent='المقطع المقترح سليم. اعتمده مع إبقاء بقية نقاط الرسم.';
  }
  state.candidate=geometry;
  confirm.disabled=false;
 }
 paintBoundarySelection(e){
  const state=e.follow,ui=e.followUI;
  e.followSelection.clearLayers();
  const target=state.replacement?.target;
  if(target)L.polyline(target.path.points,{interactive:false,color:'#718096',dashArray:'5 5',weight:4,smoothFactor:0}).addTo(e.followSelection);
  for(const pick of [state.start,state.end].filter(Boolean)){
   L.circleMarker(pick.vertex,{interactive:false,radius:6,color:'#00296b',fillColor:'#ffc600',fillOpacity:1}).addTo(e.followSelection);
  }
  const path=state.paths?.[state.direction];
  if(path)L.polyline(path.points,{interactive:false,color:'#00296b',weight:6,smoothFactor:0}).addTo(e.followSelection);
  ui.replace.hidden=state.resume||!e.region.geometry||!!state.replacement;
  ui.reselect.hidden=!target;
  ui.confirm.textContent=target?'اعتماد الاستبدال':state.replacement?'اعتماد المقطع المراد استبداله':'اعتماد المقطع ومتابعة الرسم';
  ui.confirm.disabled=!path||!!target;
  ui.alternate.hidden=!path;
  if(state.replacement){
   state.candidate=null;
   e.boundaryLines.clearLayers();
   e.highlights.clearLayers();
   e.showHighlights.hidden=true;
   if(target&&path){
    ui.status.textContent='جارٍ فحص المقطع المقترح…';
    this.previewBoundaryReplacement(e,state,path);
    return;
   }
   ui.status.textContent=path?'راجع المقطع الحالي المظلّل ثم اعتمده لاختيار الحد المرجعي.':
    state.start?'اختر نهاية المقطع على الحد نفسه.':
    target?'اختر المرجع ثم انقر بداية المقطع البديل على حدّه.':'انقر بداية المقطع المراد استبداله على الحد الحالي.';
   return;
  }
  ui.status.textContent=path?'هذا هو المقطع المختار بين النقطتين. اعتمده لمتابعة رسم حدود المنطقة.':
   state.start?'اختر نهاية المقطع على الحد نفسه.':'اختر بداية المقطع على الحد المظلّل.';
 }
 finishBoundaryFollow(e,usePath=false){
  const state=e.follow;
  if(!state)return;
  const path=usePath?state.paths?.[state.direction]:null;
  if(usePath&&!path)return;
  e.follow=null;
  e.mapMode=null;
  e.followUI.panel.hidden=true;
  e.drawControl.getContainer().hidden=false;
  e.followUI.editingControls.forEach((control,index)=>control.disabled=state.editingDisabled[index]);
  e.followSource.clearLayers();
  e.followSelection.clearLayers();
  if(state.resume||path){
   const handler=this.polygonDrawing(e);
   e.usedBoundary=!!path||state.usedBoundary;
   handler.enable();
   const points=[...state.sketch,...(path?.points||[])];
   let previous;
   e.copyingBoundary=true;
   try{
    for(const point of points){
     if(!previous||previous.lat!==point.lat||previous.lng!==point.lng)handler.addVertex(point);
     previous=point;
    }
   }finally{e.copyingBoundary=false;}
   this.previewDrawing();
  }else this.checkEditor();
  this.updateBoundaryFollow(e);
 }
 snapBoundaryPoint(e,point,excluded=[]){
  if(!e.snap.checked||!e.snapCandidates||e.copyingBoundary)return null;
  const pixel=e.map.project(point),radius=L.point(10,10);
  const southwest=e.map.unproject(pixel.subtract(radius));
  const northeast=e.map.unproject(pixel.add(radius));
  let best=null,limit=10;
  for(const [lng,lat] of e.snapCandidates([southwest.lng,southwest.lat],[northeast.lng,northeast.lat])){
   const vertex=L.latLng(lat,lng);
   if(excluded.some(other=>other?.equals(vertex,0)))continue;
   const distance=pixel.distanceTo(e.map.project(vertex));
   if(distance<=limit&&e.map.distance(point,vertex)<=15){best=vertex;limit=distance;}
  }
  return best;
 }
 snapBoundaryDrag(e,layer){
  const editing=layer.editing,initialize=editing?._initHandlers;
  if(!initialize)return;
  const app=this;
  // Bind the override before Leaflet Draw wires its vertex marker listeners.
  editing._initHandlers=function(){
   initialize.call(this);
   for(const handler of this._verticesHandlers){
    const drag=handler._onMarkerDrag;
    const touch=handler._onTouchMove;
    const nearby=marker=>[marker._prev?.getLatLng(),marker._next?.getLatLng()];
    handler._onMarkerDrag=function(event){
     const marker=event.target;
     const snapped=app.snapBoundaryPoint(e,marker.getLatLng(),nearby(marker));
     if(snapped)marker.setLatLng(snapped);
     drag.call(this,event);
    };
    handler._onTouchMove=function(event){
     const finger=event.originalEvent?.touches?.[0];
     const marker=event.target;
     const snapped=finger&&app.snapBoundaryPoint(e,e.map.mouseEventToLatLng(finger),nearby(marker));
     if(!snapped){touch.call(this,event);return;}
     marker.setLatLng(snapped);
     drag.call(this,event);
    };
   }
  };
 }
 initEditorMap(){
  const e=this.editor;
  if(!e||!window.L||!L.Draw){if(e){e.status.textContent='تعذر تحميل أدوات الخريطة. أعد فتح الصفحة.';e.saveHint.textContent=e.status.textContent;}return;}
  const editText=L.drawLocal.edit;
  Object.assign(editText.toolbar.actions.save,{title:'اعتماد تغييرات الخريطة',text:'اعتماد الرسم'});
  Object.assign(editText.toolbar.actions.cancel,{title:'التراجع عن تغييرات الخريطة',text:'تراجع'});
  Object.assign(editText.handlers.edit.tooltip,{text:'اسحب النقاط لتعديل الحدود.',subtext:'اضغط «تراجع» لإلغاء تعديل الرسم.'});
  const drawText=L.drawLocal.draw;
  Object.assign(drawText.toolbar.actions,{title:'إلغاء الرسم الحالي',text:'إلغاء الرسم'});
  Object.assign(drawText.toolbar.finish,{title:'إغلاق المضلع',text:'إغلاق'});
  Object.assign(drawText.toolbar.undo,{title:'حذف آخر نقطة',text:'حذف آخر نقطة'});
  Object.assign(drawText.handlers.polygon.tooltip,{start:'اختر نقطة البداية.',cont:'أضف بقية نقاط الحدود.',end:'اضغط نقطة البداية لإغلاق المضلع.'});
  e.map=L.map('region-editor-map').setView([31.96,44.36],10);
  for(const panel of [e.followUI.panel,e.followUI.drawing]){
   L.DomEvent.disableClickPropagation(panel);
   L.DomEvent.disableScrollPropagation(panel);
  }
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(e.map);
  e.context=L.featureGroup().addTo(e.map);
  e.drawn=L.featureGroup().addTo(e.map);
  e.boundaryLines=L.featureGroup().addTo(e.map);
  e.highlights=L.featureGroup().addTo(e.map);
  e.followSource=L.featureGroup().addTo(e.map);
  e.followSelection=L.featureGroup().addTo(e.map);
  e.drawControl=new L.Control.Draw({position:'topleft',draw:{marker:false,circle:false,circlemarker:false,rectangle:false,polyline:false,polygon:{allowIntersection:true,showArea:true,shapeOptions:{color:'#00296b',weight:3,smoothFactor:0}}},edit:{featureGroup:e.drawn,remove:true,edit:{selectedPathOptions:{maintainColor:true}}}});
  e.map.addControl(e.drawControl);
  const handler=this.polygonDrawing(e),addVertex=handler.addVertex;
  handler.addVertex=point=>{
   const last=handler._poly?.getLatLngs().at(-1);
   const snapped=this.snapBoundaryPoint(e,point);
   if(!snapped||!last?.equals(snapped,0))addVertex.call(handler,snapped||point);
  };
  this.drawContext();
  const liveEdit=()=>this.previewEditedGeometry(e);
  e.drawn.on('layeradd',event=>{
   this.snapBoundaryDrag(e,event.layer);
   event.layer.on('editdrag',liveEdit);
  });
  e.drawn.on('layerremove',event=>event.layer.off('editdrag',liveEdit));
  this.renderEditorGeometry();

  const commit=()=>{e.region.geometry=this.polygonGeometry(this.editorPolygons(e));};
  const start=mode=>{
   e.mapMode=mode;
   e.followUI.drawIssue.hidden=true;
   if(mode==='draw'){e.boundaryLines.clearLayers();e.highlights.clearLayers();e.showHighlights.hidden=true;}
   e.save.disabled=true;
   e.save.textContent='حفظ المسودة';
   e.nextPreview=null;
   e.generation++;
   clearTimeout(e.timer);
   e.saveHint.textContent=this.draftBlocker(e,e.region,{valid:false});
   this.updateBoundaryFollow(e);
  };
  const stop=()=>{
   clearTimeout(e.previewTimer);
   e.previewTimer=null;
   e.nextPreview=null;
   e.mapMode=null;
   e.usedBoundary=false;
   this.updateBoundaryDrawing(e);
   e.map.getContainer().classList.remove('region-sketch-preview');
   e.boundaryLines.clearLayers();
   this.updateBoundaryFollow(e);
   this.checkEditor();
  };
  e.map.on(L.Draw.Event.CREATED,event=>{
   if(!e.addPart.checked)e.drawn.clearLayers();
   e.drawn.addLayer(event.layer);
   commit();
   this.checkEditor();
  });
  e.map.on('draw:edited draw:deleted',commit);
  e.map.on('draw:editvertex draw:editmove',liveEdit);
  e.map.on('draw:drawstart',()=>start('draw'));
  e.map.on('draw:editstart',()=>start('edit'));
  e.map.on('draw:deletestart',()=>start('delete'));
  e.map.on('draw:drawstop draw:editstop draw:deletestop',stop);
  e.map.on('draw:drawvertex',()=>this.previewDrawing());
  e.map.on('mousemove',event=>{if(e.mapMode==='draw')this.previewDrawing(event.latlng);});
  e.map.on('click',event=>{if(e.follow)this.chooseBoundaryVertex(e,event.latlng);});
  this.updateBoundaryFollow(e);
  this.checkEditor();
 }
 previewDrawing(cursor){
  const e=this.editor;
  if(e?.mapMode!=='draw')return;
  if(!cursor)this.updateBoundaryDrawing(e);
  this.queueGeometryPreview(()=>{
   const handler=this.polygonDrawing(e);
   if(!handler?._poly)return undefined;
   const points=handler._poly.getLatLngs().map(p=>[p.lng,p.lat]);
   const polygons=e.addPart.checked?this.editorPolygons(e):[];
   if(cursor&&points.length>=3){
    const marker=handler._markers?.[0]?.getElement();
    const first=e.map.latLngToContainerPoint([points[0][1],points[0][0]]);
    const candidate=e.map.latLngToContainerPoint(cursor);
    const xTolerance=(marker?.offsetWidth||12)/2;
    const yTolerance=(marker?.offsetHeight||12)/2;
    if(Math.abs(first.x-candidate.x)<=xTolerance&&Math.abs(first.y-candidate.y)<=yTolerance){
     // Clicking the first drawing marker closes to its saved coordinate.
     return {geometry:this.polygonGeometry([...polygons,[[...points,points[0]]]]),closing:true};
    }
   }
   const last=points.at(-1);
   const end=cursor&&(this.snapBoundaryPoint(e,cursor)||cursor);
   if(end&&last&&(last[0]!==end.lng||last[1]!==end.lat))points.push([end.lng,end.lat]);
   return {sketch:points,geometry:this.polygonGeometry(polygons)};
  });
 }
 drawContext(focusParent=false){
  const e=this.editor;
  if(!e?.context)return;
  e.context.clearLayers();
  const parentId=e.fields.parent_id.value,level=Number(e.fields.level.value);
  const references=this.prospective();
  e.snapCandidates=RegionGeometry312.createBoundarySnap({regionId:e.region.regionId,parent_id:parentId,level},references);
  for(const r of references){
   const selectedParent=r.regionId===parentId;
   const parentGuide=selectedParent||(!parentId&&Number(r.level)===level-1);
   if(r.regionId===e.region.regionId||!r.geometry||r.archived||(!parentGuide&&Number(r.level)!==level))continue;
   try{
    const layer=L.geoJSON(r.geometry,{smoothFactor:0,style:{color:parentGuide?'#456797':'#8b98aa',
     dashArray:parentGuide?'7 6':undefined,weight:parentGuide?2:1,fillOpacity:parentGuide?0.025:0.04}})
     .bindTooltip(node('span',r.name_ar||r.name)).addTo(e.context);
    if(focusParent&&selectedParent&&layer.getBounds().isValid()){
     e.map.stop().fitBounds(layer.getBounds(),{padding:[24,24],maxZoom:15,animate:false});
    }
   }catch{}
  }
  this.updateBoundaryFollow(e);
 }
 renderEditorGeometry(){const e=this.editor;if(!e?.drawn)return;e.drawn.clearLayers();if(e.region.geometry)try{for(const geometry of (e.region.geometry.type==='MultiPolygon'?e.region.geometry.coordinates.map(coordinates=>({type:'Polygon',coordinates})):[e.region.geometry]))L.geoJSON(geometry,{style:{color:'#00296b',weight:3,fillOpacity:.12},onEachFeature:(_,layer)=>{if(layer instanceof L.Polygon)e.drawn.addLayer(layer);else layer.eachLayer?.(p=>e.drawn.addLayer(p));}});e.map.fitBounds(e.drawn.getBounds(),{padding:[24,24],maxZoom:15});}catch{}else{const parent=this.prospective().find(r=>r.regionId===e.fields.parent_id.value);if(parent?.geometry)try{e.map.fitBounds(L.geoJSON(parent.geometry).getBounds(),{padding:[20,20],maxZoom:12});}catch{}}}
 async importGeometry(file){if(!file)return;try{if(file.size>250000)throw Error('ملف الحدود كبير جدًا.');const raw=JSON.parse(await file.text());let geometry=raw.type==='Feature'?raw.geometry:raw;if(raw.type==='FeatureCollection'){const polygons=[];for(const f of raw.features){if(f.geometry.type==='Polygon')polygons.push(f.geometry.coordinates);else if(f.geometry.type==='MultiPolygon')polygons.push(...f.geometry.coordinates);else throw Error('الملف يحتوي أشكالًا غير مضلعات.');}geometry=polygons.length===1?{type:'Polygon',coordinates:polygons[0]}:{type:'MultiPolygon',coordinates:polygons};}this.editor.region.geometry={type:geometry.type,coordinates:geometry.coordinates};this.renderEditorGeometry();this.checkEditor();}catch(e){if(this.editor)this.editor.status.textContent=e.message;}}
 async saveEditor(){
  const e=this.editor;
  if(!e||e.save.disabled||!e.structureValid||e.mapMode)return;
  const region=this.readEditor();
  e.saving=true;
  e.save.disabled=true;
  e.saveHint.textContent='جارٍ حفظ المسودة…';
  try{
   const result=await api('/draft',{region,...(e.operation?{operation:e.operation}:{}),catalogDigest:this.catalog.digest,expectedDraftVersion:e.draftVersion,reason:e.fields.reason.value.trim()});
   if(result.draft?.status!=='DRAFT'||result.draft.region?.regionId!==region.regionId)throw Object.assign(Error(),{code:'REGION_DRAFT_CONFIRMATION_MISSING'});
   if(this.editor!==e)return;
   this.closeRegionModal();
   await this.load();
   const saved='حُفظت مسودة «'+region.name_ar+'».';
   const firstIssue=result.validation?.errors?.[0];
   this.notice(firstIssue?saved+' '+firstIssue.message+(firstIssue.regionName?' «'+firstIssue.regionName+'».':''):saved+' راجعها من قسم المسودات قبل النشر.');
  }catch(error){
   if(this.editor!==e)return;
   e.saveHint.textContent=errorText(error);
   e.saving=false;
   e.save.disabled=false;
  }
 }

}
window.RegionManagement312={App,api};
async function boot(){const root=document.querySelector('.page-content');if(!root)return;for(const id of ['regionModal','drawRegionModal'])document.getElementById(id)?.remove();const app=new App(root);window.regionsManager=app;app.refreshRegions=()=>app.load();await app.load();}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
