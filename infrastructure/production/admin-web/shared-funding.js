'use strict';

(() => {
  const api='/staff/merchants/agreements';
  const byId=name=>document.getElementById('funding-'+name);
  const editor=byId('editor'),form=byId('form'),branchFilter=byId('branch'),editorBranch=byId('editor-branch');
  const stateFilter=byId('state'),campaign=byId('campaign'),share=byId('merchant-share');
  const date=new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
  const percent=new Intl.NumberFormat('ar-IQ',{style:'percent',maximumFractionDigits:2});
  const count=new Intl.NumberFormat('ar-IQ');
  const labels={READY:'جاهزة للاعتماد',WAITING:'بانتظار موافقة المطعم',APPROVED:'معتمدة',EXPIRED:'منتهية'};
  const errors={
    PERMISSION_REQUIRED:'حسابك لا يملك صلاحية إدارة تمويل العروض.',
    ADMIN_MFA_REQUIRED:'فعّل التحقق بخطوتين لحساب الإدارة.',
    BUSINESS_UNAVAILABLE:'لم يعد هذا الفرع متاحًا للعملية.',
    INVALID_COMMERCIAL_REQUEST:'راجع بيانات المشاركة أو أعد تحميل الصفحة.',
    OWNER_ACCEPTANCE_REQUIRED:'ينتظر الطلب موافقة المطعم على هذه النسخة.',
    REQUESTER_PERMISSION_REVOKED:'تغيّرت صلاحيات مُعدّ الطلب. أعد إرسال الشروط.',
    VERSION_OR_STATE_CONFLICT:'تغيّرت حالة المشاركة. حدّث القائمة ثم أعد المحاولة.',
    SHARING_POLICY_EXISTS:'يوجد تمويل معتمد لهذا العرض في الفرع.',
    CAMPAIGN_VERSION_REQUIRED:'تغيّرت الحملة. حدّث قائمة العروض واختر النسخة الحالية.',
    CAMPAIGN_PERIOD_CHANGED:'تغيّرت مدة الحملة. أعد إرسال الشروط للموافقة.',
    COMMERCIAL_PERIOD_EXPIRED:'انتهت فترة العرض.',
    FUNDING_TOTAL_USAGE_LIMIT_REQUIRED:'حدد إجمالي الاستخدام المسموح للعرض.',
    FUNDING_DISCOUNT_CAP_REQUIRED:'حدد سقفًا للخصم في العرض.',
    SHARED_DISCOUNT_TERMS_LOCKED:'اعتُمدت الشروط، ويمكن فتح مشاركة لعرض جديد.',
  };
  const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(value);
  const url=new URL(location.href);
  let branchId=id(url.searchParams.get('businessId'))?url.searchParams.get('businessId'):'';
  let source=['PLATFORM','MERCHANT'].includes(url.searchParams.get('source'))?url.searchParams.get('source'):'';
  let campaignId=source&&id(url.searchParams.get('campaignId'))?url.searchParams.get('campaignId'):'';
  const initialStatus=url.searchParams.get('status');
  if (Object.hasOwn(labels,initialStatus)) stateFilter.value=initialStatus;
  const branches=new Map();
  let queueCursor,branchCursor,entries=[],can={},sequence=0,offerSequence=0,branchBusy=false,saving=false,editing,options=[];
  let lastPayload,lastRequestId,proposalId;

  function element(tag,text,className) {
    const node=document.createElement(tag);
    if (text!=null) node.textContent=text;
    if (className) node.className=className;
    return node;
  }
  function button(text,action) {
    const node=element('button',text,'campaign-secondary');
    node.type='button';
    node.onclick=action;
    return node;
  }
  const time=value=>Number.isFinite(Date.parse(value))?date.format(new Date(value)):'—';
  const ratio=values=>values.merchantNumerator/values.denominator;
  async function request(query,body) {
    await window.Auth.ensureSession();
    const token=window.Auth.getToken('accessToken');
    if (!token) throw Error('يلزم تسجيل الدخول لفتح تمويل العروض.');
    const response=await fetch(api+(query?'?'+new URLSearchParams(query):''),{
      method:body?'POST':'GET',signal:AbortSignal.timeout(25000),cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(body&&{'Content-Type':'application/json'})},
      ...(body&&{body:JSON.stringify(body)}),
    });
    const result=await response.json().catch(()=>({}));
    if (!response.ok) throw Object.assign(Error(errors[result.error]||(response.status===401
      ?'انتهت جلسة الدخول. أعد فتح المنصة.':'تعذّر إكمال العملية. حدّث البيانات وأعد المحاولة.')),{code:result.error});
    return result;
  }

  function syncUrl() {
    const current=new URL(location.href);
    for (const [key,value] of [['businessId',branchId],['status',stateFilter.value],
      ['campaignId',campaignId],['source',campaignId?source:'']]){
      if (value) current.searchParams.set(key,value); else current.searchParams.delete(key);
    }
    history.replaceState(null,'',current);
    byId('clear-campaign').hidden=!campaignId;
  }
  function branchItems(select,value,placeholder) {
    const rows=[...branches.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));
    select.replaceChildren(new Option(placeholder,''),...rows.map(row=>new Option(row.name,row.id)));
    if (value&&!branches.has(value)) select.add(new Option('الفرع المحدد',value));
    select.value=value;
  }
  function syncBranches() {
    branchItems(branchFilter,branchId,'جميع الفروع');
    branchItems(editorBranch,editorBranch.value,'اختر الفرع');
  }
  async function loadBranches(more=false,selected) {
    if (!selected&&branchBusy) return;
    if (!selected) branchBusy=true;
    try {
      const result=await request({view:'funding-branches',...(selected&&{businessId:selected}),
        ...(more&&branchCursor&&{cursor:branchCursor})});
      for(const branch of result.items) branches.set(branch.id,branch);
      if(!selected) branchCursor=result.nextCursor;
      syncBranches();
    } catch(error) {
      if (editor.open) byId('editor-status').textContent=error.message;
      else byId('status').textContent=error.message;
    } finally {
      if(!selected) branchBusy=false;
      byId('branches-more').hidden=byId('editor-branches-more').hidden=!branchCursor;
    }
  }
  function fact(list,label,value) {
    const row=element('div');
    row.append(element('dt',label),element('dd',value));
    list.append(row);
  }
  function render() {
    const list=byId('list');
    list.replaceChildren();
    byId('new').hidden=!can.fundingRequest;
    byId('more').hidden=!queueCursor;
    if (!entries.length) {
      list.append(element('p',queueCursor?'لا توجد نتائج في الدفعة الحالية.':'لا توجد مشاركات مطابقة للتصفية.'));
      return;
    }
    for (const item of entries) {
      const card=element('article',null,'campaign-card'),header=element('header');
      const badge=element('span',labels[item.status],'campaign-status');
      if(item.status==='READY') badge.classList.add('funding-ready');
      header.append(element('h2',item.campaignLabel),badge);
      card.append(header,element('p',item.branch.name,'funding-card-branch'));
      const info=element('dl'),fraction=ratio(item.draft.values);
      fact(info,'حصة المطعم',percent.format(fraction));
      fact(info,'حصة المنصة',percent.format(1-fraction));
      fact(info,'بداية السريان',time(item.draft.values.effectiveFrom));
      fact(info,'نهاية السريان',time(item.draft.values.effectiveTo));
      if (item.acceptedRole) fact(info,'وافَق',item.acceptedRole==='MANAGER'?'مدير الفرع':'المالك');
      card.append(info);
      const actions=element('div',null,'campaign-actions');
      if (can.fundingRequest&&['WAITING','READY'].includes(item.status))
        actions.append(button('تعديل الشروط',()=>open(item)));
      if (can.fundingApprove&&item.status==='READY')
        actions.append(button('اعتماد المشاركة',()=>open(item,true)));
      if (actions.childElementCount) card.append(actions);
      list.append(card);
    }
  }
  async function loadQueue({more=false,message=''}={}) {
    const token=++sequence;
    byId('refresh').disabled=byId('more').disabled=true;
    byId('status').textContent='جارٍ تحميل المشاركات…';
    if (!more) {
      entries=[];queueCursor=null;
      byId('list').replaceChildren();
      byId('more').hidden=true;
    }
    const query={view:'funding-queue',...(branchId&&{businessId:branchId}),
      ...(stateFilter.value&&{status:stateFilter.value}),...(campaignId&&{campaignId,source})};
    try {
      let next=queueCursor, result;
      for (let page=0;page<3;page++){
        result=await request({...query,...(next&&{cursor:next})});
        if(token!==sequence) return;
        next=result.nextCursor;
        if(result.items.length||!next) break;
      }
      queueCursor=result.nextCursor;
      can=result.can;
      const merged=new Map(entries.map(row=>[row.id,row]));
      for (const row of result.items) merged.set(row.id,row);
      entries=[...merged.values()];
      render();
      byId('status').textContent=message;
    } catch(error) {
      if(token!==sequence) return;
      byId('status').textContent=error.message;
      byId('new').hidden=true;
    } finally {
      if(token===sequence) byId('refresh').disabled=byId('more').disabled=false;
    }
  }
  function showTerms() {
    const offer=options.find(row=>row.key===campaign.value);
    const value=Number(share.value);
    byId('offer-terms').textContent=offer
      ?'فترة العرض من '+time(offer.from)+' إلى '+time(offer.to)+' · إجمالي الاستخدام '+count.format(offer.usageLimit):'';
    byId('platform-share').textContent=value>0&&value<100?'حصة المنصة '+percent.format(1-value/100):'';
  }
  async function loadOffers() {
    const token=++offerSequence;
    options=[];
    campaign.replaceChildren(new Option('اختر العرض',''));
    byId('save').disabled=true;
    showTerms();
    if (!editorBranch.value) return;
    byId('editor-status').textContent='جارٍ تحميل العروض…';
    try {
      const {options:rows}=await request({businessId:editorBranch.value,view:'funding-options'});
      if(token!==offerSequence||!editor.open) return;
      const selected=editing?.draft.values;
      const wanted=selected?.campaignId||campaignId;
      const kind=selected?.source||source;
      options=rows.filter(row=>(!wanted||row.id===wanted&&row.source===kind)&&
        !row.fundingError&&row.version&&row.from&&Date.parse(row.to)>Date.now());
      campaign.replaceChildren(new Option('اختر العرض',''),...options.map(row=>new Option(row.label,row.key)));
      if (wanted&&options.length===1) campaign.value=options[0].key;
      byId('editor-status').textContent=options.length?'':'لا توجد عروض مؤهلة. تحقق من مدة العرض وحد الاستخدام وسقف خصم النسبة.';
      byId('save').disabled=!options.length;
      showTerms();
    } catch(error) {
      if(token===offerSequence) byId('editor-status').textContent=error.message;
    }
  }
  function open(item,approve=false) {
    form.reset();
    editing=item;
    proposalId=item?.id||crypto.randomUUID();
    lastPayload=lastRequestId=null;
    byId('proposal').hidden=approve;
    byId('confirmation').hidden=!approve;
    byId('confirmation').textContent=approve?item.campaignLabel+' · '+item.branch.name:'';
    byId('editor-title').textContent=approve?'اعتماد المشاركة':item?'تعديل شروط المشاركة':'مشاركة تمويل جديدة';
    byId('reason-label').textContent=approve?'سبب الاعتماد':'سبب الإعداد';
    byId('save').textContent=approve?'تأكيد الاعتماد':'إرسال الشروط إلى المطعم';
    byId('editor-status').textContent='';
    if(item) branches.set(item.branch.id,item.branch);
    branchItems(editorBranch,item?.branch.id||branchId,'اختر الفرع');
    editorBranch.disabled=approve||Boolean(item);
    share.disabled=campaign.disabled=approve;
    if(item) share.value=String(100*ratio(item.draft.values));
    byId('save').disabled=!approve;
    editor.showModal();
    if (!approve) loadOffers();
  }
  form.onsubmit=async event=>{
    event.preventDefault();
    if(saving) return;
    const approve=byId('proposal').hidden,draft=editing?.draft;
    const reason=byId('reason').value.trim();
    if(reason.length<5){byId('editor-status').textContent='اكتب سببًا من خمس حروف على الأقل.';return;}
    const record={businessId:editorBranch.value,action:approve?'APPROVE_FUNDING':'SAVE_FUNDING',
      id:proposalId,draftVersion:draft?.version||0,baseVersion:draft?.baseVersion||0,reason};
    if(approve) record.hash=draft.hash;
    else {
      const offer=options.find(row=>row.key===campaign.value);
      if(!offer) return;
      record.businessIds=[record.businessId];
      record.values={campaignId:offer.id,campaignVersion:offer.version,source:offer.source,
        effectiveFrom:offer.from,effectiveTo:offer.to,merchantNumerator:Math.round(Number(share.value)*100),
        denominator:10000,merchantShareFinalRounding:{incrementIqd:1,mode:'TOWARD_ZERO'}};
    }
    const signature=JSON.stringify(record);
    if(signature!==lastPayload){lastPayload=signature;lastRequestId=crypto.randomUUID();}
    saving=true;
    byId('save').disabled=byId('close').disabled=true;
    byId('editor-status').textContent='جارٍ حفظ المشاركة…';
    try {
      await request(null,{...record,requestId:lastRequestId});
      editor.close();
      await loadQueue({message:approve?'اعتُمد تمويل العرض لهذا الفرع.':'أصبحت الشروط متاحة للموافقة من تطبيق المطعم.'});
    } catch(error) {
      byId('editor-status').textContent=error.message;
    } finally {
      saving=false;
      byId('save').disabled=byId('close').disabled=false;
    }
  };
  byId('new').onclick=()=>open(null);
  byId('refresh').onclick=()=>loadQueue();
  byId('more').onclick=()=>loadQueue({more:true});
  byId('close').onclick=()=>editor.close();
  editor.addEventListener('cancel',event=>{if(saving)event.preventDefault();});
  byId('branches-more').onclick=byId('editor-branches-more').onclick=()=>loadBranches(true);
  byId('clear-campaign').onclick=()=>{campaignId=source='';syncUrl();loadQueue();};
  branchFilter.onchange=()=>{branchId=branchFilter.value;syncUrl();loadQueue();};
  stateFilter.onchange=()=>{syncUrl();loadQueue();};
  editorBranch.onchange=()=>{byId('editor-status').textContent='';loadOffers();};
  share.oninput=campaign.onchange=showTerms;
  syncBranches();
  syncUrl();
  loadQueue();
  loadBranches();
  if(branchId) loadBranches(false,branchId);
})();
