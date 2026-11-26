'use strict';

(() => {
  const api = '/campaigns-api/staff/offers';
  const get = id => document.getElementById('campaign-'+id);
  const form = get('form'), editor = get('editor'), field = name => form.elements.namedItem(name);
  const date = new Intl.DateTimeFormat('ar-IQ',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Baghdad'});
  const digits = new Intl.NumberFormat('ar-IQ');
  const byTime = value => Number.isFinite(Date.parse(value)) ? date.format(new Date(value)) : '—';
  const iqd = value => digits.format(value) + ' د.ع';
  const choices = input => [...input.selectedOptions].map(option => option.value);
  const version = state => state.revision ?? null;
  const defaults = {offers:[],merchants:[],regions:[],permissions:{}};
  const errors = {
    CAMPAIGN_FINITE_GOODS_REQUIRED:'حدد سقفًا للخصم وعددًا إجماليًا للاستخدامات ضمن الحدود المسموحة.',
    CAMPAIGN_CODE_REQUIRED:'أدخل رمز خصم صالحًا.',
    CAMPAIGN_PUSH_NOT_LIVE:'إرسال الإشعار متاح خلال فترة سريان الحملة.',
    CAMPAIGN_PUSH_ALREADY_REQUESTED:'سُجل طلب إرسال لهذه النسخة. حدّث حالة الإشعار.',
    CAMPAIGN_PUSH_INVALID:'راجع عنوان الإشعار ونصّه.',
    VERSION_OR_STATE_CONFLICT:'تغيّرت الحملة. حدّث القائمة قبل المتابعة.',
    CAMPAIGN_IMAGE_INVALID:'اختر صورة صالحة أو ملف GIF لا يتجاوز ٣ ميغابايت.',
    'Uploaded campaign image is unavailable.':'تعذّر العثور على الصورة. اخترها وأعد الحفظ.',
    'Upload an image using your own account.':'ارفع الصورة من حسابك قبل استخدامها.',
    CAMPAIGN_REQUEST_INVALID:'راجع بيانات الحملة والإجراء المحدد.',
    PERMISSION_REQUIRED:'حسابك لا يملك صلاحية هذا الإجراء.',
    ADMIN_MFA_REQUIRED:'يلزم تفعيل التحقق بخطوتين للحساب الإداري.',
    'This campaign code is already in use.':'رمز الخصم مستخدم في حملة أخرى.',
    'This offer changed in another window. Reload it before saving.':'تغيّرت الحملة. حدّث القائمة قبل متابعة التعديل.',
    'The offer or code changed. Reload the latest version before saving.':'تغيّرت الحملة أو رمز الخصم. حدّث القائمة ثم أعد المحاولة.',
    'The offer has expired. Choose a future end time before activating it.':'انتهت مدة الحملة. عدّل تاريخ النهاية قبل النشر.',
    'The offer has reached its usage limit. Increase the limit before activating it.':'بلغت الحملة حد الاستخدام. عدّل الحد قبل إعادة النشر.',
    'Choose merchants within your assigned regions.':'أحد المطاعم المحددة غير متاح ضمن صلاحيات حسابك.',
    'A selected region no longer exists.':'إحدى المناطق المحددة غير متاحة.',
    'No selected merchant is currently available. Save a draft or choose an active merchant.':'اختر مطعمًا متاحًا لنشر الحملة.',
    'None of the selected products are currently available. Save a draft or select available products.':'اختر صنفًا متاحًا لنشر الحملة.',
  };
  let state = defaults, editing, catalogueVersion = 0, busy = false;
  let imageKey = '', localImage, selectedImage;
  let noticeOffer, noticeBusy=false, noticeState;
  const notice=get('notice');
  const noticeLabels={
    NOT_REQUESTED:'لم يُطلب إرسال إشعار لهذه النسخة.',
    QUEUED:'الإشعار في قائمة الإرسال.',
    SENDING:'جارٍ إرسال الإشعار.',
    SENT:'قبلت خدمة الإشعارات الإرسال.',
    NO_RECIPIENTS:'لا توجد أجهزة مؤهلة لاستلام الإشعار.',
    PARTIAL:'أُرسل الإشعار إلى بعض الأجهزة.',
    FAILED:'تعذّر إرسال الإشعار.',
    CANCELLED:'توقّف الإرسال بعد تغيّر الحملة أو انتهاء مدتها.',
  };

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  function button(text, callback, primary = false) {
    const element = node('button',text,primary ? null : 'campaign-secondary');
    element.type = 'button';
    element.addEventListener('click',callback);
    return element;
  }
  async function request(query, body) {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    if (!token) throw Error('يلزم تسجيل الدخول لفتح حملات الخصم.');
    const response = await fetch(api + (query ? '?' + new URLSearchParams(query) : ''), {
      method:body ? 'POST' : 'GET',signal:AbortSignal.timeout(27000),cache:'no-store',
      headers:{Authorization:'Bearer '+token,...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    const value = await response.json().catch(()=>({}));
    if (window.Auth.getToken('accessToken')!==token) throw Error('تغيرت جلسة الدخول. حدّث القائمة.');
    if (!response.ok) throw Error(errors[value.error] || (response.status===401 ?
      'انتهت جلسة الدخول. أعد فتح المنصة.' : 'تعذّر إكمال الإجراء. راجع البيانات وحدّث القائمة.'));
    return value;
  }
  function fact(label,value) {
    const part=node('div');
    part.append(node('dt',label),node('dd',value));
    return part;
  }
  function render() {
    const list=get('list');
    list.replaceChildren();
    get('new').hidden=!state.permissions.create;
    if (!state.offers.length) {
      list.append(node('p','لا توجد حملات خصم حاليًا.'));
      return;
    }
    for (const offer of state.offers) {
      const item=node('article',null,'campaign-card'), header=node('header');
      const ended=Date.parse(offer.endAt)<=Date.now();
      const scheduled=offer.status==='active' && Date.parse(offer.startAt)>Date.now();
      const status=scheduled?'مجدولة':offer.status==='active'?(ended?'منتهية':'سارية'):
        offer.status==='draft'?'مسودة':'متوقفة';
      const code=node('bdi',offer.code || '—');
      header.append(node('h2',offer.title),node('span',status,'campaign-status'));
      const facts=node('dl'), codeFact=fact('رمز الخصم');
      codeFact.querySelector('dd').append(code);
      facts.append(codeFact,fact('قيمة الخصم',offer.type==='percentage'?digits.format(offer.value)+'٪':iqd(offer.value)),
        fact('السقف لكل طلب',iqd(offer.type==='percentage'?offer.maximumSavings:offer.value)),
        fact('الاستخدامات',digits.format(offer.usage)+' من '+digits.format(offer.usageLimit)),fact('ينتهي في بغداد',byTime(offer.endAt)));
      item.append(header);
      if (offer.imageUrl) item.append(Object.assign(node('img',null,'campaign-image'),
        {src:offer.imageUrl,alt:offer.title,loading:'lazy'}));
      item.append(facts);
      if (offer.description) item.append(node('p',offer.description));
      const actions=node('div',null,'campaign-actions');
      if (offer.sharingLocked) {
        const funding=node('a','التمويل المشترك للعروض','button campaign-secondary');
        funding.href='/pages/shared-funding.html?'+new URLSearchParams({source:'PLATFORM',campaignId:offer.id});
        actions.append(funding);
      }
      if (state.permissions.edit && !offer.sharingLocked && !offer.unsupported &&
          (offer.status!=='active'||state.permissions.approve))
        actions.append(button('تعديل الحملة',()=>open(offer)));
      if (state.permissions.approve && !offer.unsupported && (offer.status==='active' || !ended)) {
        const publish=offer.status!=='active';
        actions.append(button(publish?(offer.status==='draft'?'نشر الحملة':'استئناف الحملة'):'إيقاف الحملة',
          event=>changeStatus(offer,publish,event.currentTarget),publish));
      }
      if (!offer.unsupported && offer.status!=='draft')
        actions.append(button('إشعار الحملة',()=>openNotice(offer)));
      item.append(actions);
      list.append(item);
    }
  }
  function renderNotice(result) {
    noticeState=result;
    const counts=result.counts;
    const summary=counts ? ' الأجهزة المستهدفة '+digits.format(counts.targeted||0)+
      '، المقبولة '+digits.format(counts.sent||0)+'، المتعذرة '+digits.format(counts.failed||0)+'.' : '';
    const apns=counts?.failuresByCode?.['messaging/third-party-auth-error'] ||
      counts?.failuresByCode?.['messaging/invalid-apns-credentials'];
    get('notice-status').textContent=(noticeLabels[result.notificationStatus]||'تعذّر عرض الحالة.')+
      summary+(apns?' تحقّق من إعدادات Apple للإشعارات قبل إعادة المحاولة.':'');
    const offer=noticeOffer, live=offer.status==='active'&&Date.parse(offer.startAt)<=Date.now()&&Date.parse(offer.endAt)>Date.now();
    const send=live&&state.permissions.edit&&state.permissions.approve&&
      (result.notificationStatus==='NOT_REQUESTED'||result.retryable===true);
    get('notice-fields').hidden=!send;
    get('notice-send').hidden=!send;
    get('notice-send').textContent=result.retryable?'إعادة محاولة الإرسال':'إرسال الإشعار';
    const retry=result.retryable===true;
    for (const key of ['title','body']) {
      const input=get('notice-'+key);
      input.readOnly=retry;
      if (result.notification?.[key]) input.value=result.notification[key];
    }
  }
  async function runNotice(sending=false) {
    if (noticeBusy) return;
    noticeBusy=true;
    get('notice-send').disabled=true;
    get('notice-refresh').disabled=true;
    get('notice-status').textContent=sending?'جارٍ تجهيز الإشعار…':'جارٍ تحميل حالة الإشعار…';
    try {
      const offer=noticeOffer;
      const scope={source:'PLATFORM',discountId:offer.id};
      if (sending) {
        await request(null,{action:'NOTIFY',...scope,baseRevision:version(offer),
          notification:{title:get('notice-title').value.trim(),body:get('notice-body').value.trim()}});
      }
      renderNotice(await request(null,{action:'NOTIFY_STATUS',...scope}));
    }catch(error){get('notice-status').textContent=error.message;}
    finally {
      noticeBusy=false;
      get('notice-send').disabled=false;
      get('notice-refresh').disabled=false;
    }
  }
  function openNotice(offer) {
    if (noticeBusy) return;
    noticeOffer=offer;
    noticeState=undefined;
    get('notice-name').textContent=offer.title;
    get('notice-title').value=offer.title.slice(0,100);
    get('notice-body').value=(offer.description||'عرض جديد متاح في تطبيق ويز').slice(0,150);
    get('notice-fields').hidden=true;
    get('notice-send').hidden=true;
    notice.showModal();
    runNotice();
  }
  async function load() {
    state=await request();
    render();
  }
  async function refresh() {
    if (busy) return;
    get('refresh').disabled=true;
    get('status').textContent='جارٍ تحميل الحملات…';
    try { await load();get('status').textContent=''; }
    catch (error) { get('status').textContent=error.message; }
    finally { get('refresh').disabled=false; }
  }
  async function changeStatus(offer,publish,trigger) {
    if (busy) return;
    busy=true;trigger.disabled=true;
    get('status').textContent='جارٍ حفظ الحالة…';
    try {
      await request(null,{operation:'status',id:offer.id,source:offer.source,
        baseRevision:version(offer),status:publish?'active':'paused'});
      await load();
      get('status').textContent=publish?'نُشرت الحملة وفق فترة السريان المحددة.':'أُوقفت الحملة.';
    } catch (error) { get('status').textContent=error.message; }
    finally { busy=false;trigger.disabled=false; }
  }
  function fillChoices(input,rows,selected=[]) {
    input.replaceChildren(...rows.map(row=>new Option(row.label,row.id,false,selected.includes(row.id))));
  }
  const local = iso => new Date(Date.parse(iso)+3*3600000).toISOString().slice(0,16);
  const time = localValue => new Date(localValue+'+03:00').toISOString();
  function updateValue() {
    const percent=field('type').value==='percentage';
    get('value-label').querySelector('span').textContent=percent?'النسبة المئوية':'مبلغ الخصم بالدينار';
    Object.assign(field('value'),{min:percent?'0.001':'250',max:percent?'100':'1000000000',step:percent?'0.001':'1'});
    get('cap-label').hidden=!percent;
    field('maximumSavings').disabled=!percent;
  }
  async function selectItems(selected=[]) {
    const token=++catalogueVersion, selection=field('selections');
    selection.replaceChildren();
    get('items-label').hidden=field('applicability').value==='allItems';
    if (get('items-label').hidden) return;
    const merchants=choices(field('merchantIds'));
    if (merchants.length!==1) {
      get('editor-status').textContent='اختر مطعمًا واحدًا لتحديد الأصناف أو الأقسام.';
      return;
    }
    get('editor-status').textContent='جارٍ تحميل قائمة المطعم…';
    get('save').disabled=true;
    try {
      const catalogue=await request({merchantId:merchants[0]});
      if (token!==catalogueVersion || !editor.open) return;
      fillChoices(selection,field('applicability').value==='specificItems'?catalogue.products:catalogue.categories,selected);
      get('editor-status').textContent='';
    } catch (error) { if (token===catalogueVersion) get('editor-status').textContent=error.message; }
    finally { if (token===catalogueVersion) get('save').disabled=false; }
  }
  function releaseLocalImage() {
    if (localImage) URL.revokeObjectURL(localImage);
    localImage=undefined;
  }
  function showImage(url) {
    const preview=get('image-preview');
    preview.hidden=!url;
    if (url) preview.src=url;
    else preview.removeAttribute('src');
    get('image-remove').hidden=!url && !imageKey;
  }
  async function encodeImage(file) {
    const animation=file.type==='image/gif';
    if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type) ||
        file.size>(animation?3*1024*1024:10*1024*1024)) throw Error(errors.CAMPAIGN_IMAGE_INVALID);
    const image=new Image();
    image.src=localImage;
    try { await image.decode(); } catch { throw Error(errors.CAMPAIGN_IMAGE_INVALID); }
    if (image.naturalWidth*image.naturalHeight>40000000) throw Error(errors.CAMPAIGN_IMAGE_INVALID);
    if (animation) {
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onload=()=>resolve(reader.result);
        reader.onerror=()=>reject(Error(errors.CAMPAIGN_IMAGE_INVALID));
        reader.readAsDataURL(file);
      });
      return {image:data.split(',')[1],contentType:'image/gif'};
    }
    const ratio=Math.min(1,1600/image.naturalWidth,1600/image.naturalHeight);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(image.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(image.naturalHeight*ratio));
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';
    context.fillRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    for (const quality of [.85,.7,.55,.4]) {
      const image=canvas.toDataURL('image/jpeg',quality).split(',')[1];
      if (image.length<=800000) return {image,contentType:'image/jpeg'};
    }
    throw Error(errors.CAMPAIGN_IMAGE_INVALID);
  }
  function open(offer) {
    if (busy) return;
    editing=offer;
    form.reset();
    releaseLocalImage();
    selectedImage=undefined;
    imageKey=offer?.imageKey || '';
    showImage(offer?.imageUrl);
    get('save').disabled=false;
    get('editor-title').textContent=offer?'تعديل الحملة':'حملة جديدة';
    get('save').textContent=offer?'حفظ التعديل':'حفظ المسودة';
    get('editor-status').textContent='';
    for (const name of ['title','code','description','type','value','maximumSavings','minimumOrder','usageLimit',
      'perCustomerLimit','applicability'])
      if (offer?.[name]!=null) field(name).value=offer[name];
    field('audience').value=offer?.audience?.[0] ?? 'all';
    field('firstOrderOnly').checked=offer?.firstOrderOnly===true;
    field('startAt').value=local(offer?.startAt || new Date().toISOString());
    field('endAt').value=local(offer?.endAt || new Date(Date.now()+7*86400000).toISOString());
    fillChoices(field('merchantIds'),state.merchants,offer?.merchantIds);
    fillChoices(field('regionIds'),state.regions,offer?.regionIds);
    updateValue();
    editor.showModal();
    selectItems(offer?.applicability==='specificCategories'?offer.categoryIds:offer?.itemIds);
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if (busy) return;
    const text=name=>field(name).value.trim(), number=name=>Number(text(name));
    const applicability=text('applicability'), selected=choices(field('selections')), merchantIds=choices(field('merchantIds'));
    if (applicability!=='allItems'&&(merchantIds.length!==1||!selected.length)) {
      get('editor-status').textContent='اختر مطعمًا واحدًا ثم حدّد الأصناف أو الأقسام.';
      return;
    }
    const startAt=time(text('startAt')), endAt=time(text('endAt'));
    if (startAt>=endAt) { get('editor-status').textContent='وقت النهاية يجب أن يلي وقت البداية.';return; }
    busy=true;get('save').disabled=true;get('cancel').disabled=true;
    get('image-file').disabled=true;get('image-remove').disabled=true;
    get('editor-status').textContent='جارٍ حفظ الحملة…';
    try {
      if (selectedImage) {
        get('editor-status').textContent='جارٍ رفع صورة الحملة…';
        const uploaded=await request(null,{operation:'upload-image',...await encodeImage(selectedImage)});
        imageKey=uploaded.imageKey;
        selectedImage=undefined;
        releaseLocalImage();
        get('image-file').value='';
        showImage(uploaded.imageUrl);
        get('editor-status').textContent='جارٍ حفظ الحملة…';
      }
      await request(null,{operation:'save',imageKey,id:editing?.id ?? crypto.randomUUID(),source:editing?.source ?? 'campaign',
        baseRevision:editing?version(editing):null,title:text('title'),code:text('code').toUpperCase(),
        description:text('description'),type:text('type'),value:number('value'),minimumOrder:number('minimumOrder'),
        maximumSavings:text('type')==='percentage'?number('maximumSavings'):null,startAt,endAt,
        usageLimit:number('usageLimit'),perCustomerLimit:text('perCustomerLimit')?number('perCustomerLimit'):null,
        applicability,itemIds:applicability==='specificItems'?selected:[],categoryIds:applicability==='specificCategories'?selected:[],
        merchantIds,regionIds:choices(field('regionIds')),audience:[text('audience')],firstOrderOnly:field('firstOrderOnly').checked,
        campaignType:editing?.campaignType ?? 'promotional',singleUse:editing?.singleUse===true,
        status:editing?.status==='active'?'active':editing?.status==='paused'?'paused':'draft'});
      editor.close();
      await load();
      get('status').textContent=editing?'حُفظ تعديل الحملة.':'حُفظت المسودة. افتح قائمة الحملات لنشرها.';
    } catch (error) { get(editor.open?'editor-status':'status').textContent=error.message; }
    finally {
      busy=false;get('save').disabled=false;get('cancel').disabled=false;
      get('image-file').disabled=false;get('image-remove').disabled=false;
    }
  });
  get('image-file').addEventListener('change',()=>{
    const file=get('image-file').files[0];
    if (!file || busy) return;
    releaseLocalImage();
    selectedImage=file;
    localImage=URL.createObjectURL(file);
    showImage(localImage);
  });
  get('image-remove').addEventListener('click',()=>{
    releaseLocalImage();
    selectedImage=undefined;imageKey='';
    get('image-file').value='';
    showImage('');
  });
  editor.addEventListener('close',releaseLocalImage);
  get('notice-form').addEventListener('submit',event=>{
    event.preventDefault();
    if (!get('notice-send').hidden && noticeState) runNotice(true);
  });
  get('notice-refresh').addEventListener('click',()=>runNotice());
  get('notice-close').addEventListener('click',()=>{if(!noticeBusy)notice.close();});
  notice.addEventListener('cancel',event=>{if(noticeBusy)event.preventDefault();});
  field('type').addEventListener('change',updateValue);
  for (const name of ['merchantIds','applicability']) field(name).addEventListener('change',()=>{get('save').disabled=false;selectItems();});
  get('new').addEventListener('click',()=>open());
  get('refresh').addEventListener('click',refresh);
  get('cancel').addEventListener('click',()=>editor.close());
  editor.addEventListener('cancel',event=>{if (busy) event.preventDefault();});
  refresh();
})();
