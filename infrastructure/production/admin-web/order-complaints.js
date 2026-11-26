'use strict';

(() => {
  const path = '/complaints-api/staff';
  const byId = id => document.getElementById('complaints-' + id);
  const states = {
    OPEN:'بانتظار المراجعة', IN_REVIEW:'قيد المراجعة', WAITING_CUSTOMER:'بانتظار معلومات من الزبون',
    REMEDY_PENDING:'بانتظار ربط قسيمة التعويض', DECIDED:'صدر القرار', APPEAL_REVIEW:'اعتراض قيد المراجعة', CLOSED:'مغلقة',
  };
  const types = {MISSING_ITEMS:'أصناف ناقصة', WRONG_ITEMS:'أصناف غير صحيحة', QUALITY:'جودة الطلب',
    NOT_DELIVERED:'لم يُسلّم الطلب', SAFETY:'سلامة الطلب', OTHER:'شكوى أخرى'};
  const parties = {CUSTOMER:'الزبون', MERCHANT:'المطعم', DRIVER:'السائق', PLATFORM:'المنصة'};
  const sources = {...parties, SYSTEM:'النظام', EXTERNAL:'مصدر خارجي'};
  const actions = {CLAIM:'تولّي المراجعة', ADD_EVIDENCE:'إضافة إفادة', REQUEST_INFO:'طلب معلومات من الزبون',
    DECIDE:'إصدار قرار', RESOLVE_APPEAL:'البتّ في الاعتراض', CLOSE:'إغلاق الشكوى', RELEASE:'إعادة للقائمة'};
  const outcomes = {ACCEPTED:'قبول الشكوى', REJECTED:'رفض الشكوى', UNDETERMINED:'الأدلة غير كافية'};
  const errors = {
    COMPLAINT_CHANGED:'تغيّرت الشكوى. حدّث التفاصيل قبل المتابعة.',
    COMPLAINT_OWNED_BY_OTHER:'الشكوى لدى مراجع آخر.',
    COMPLAINT_CLAIM_REQUIRED:'تولَّ المراجعة قبل تسجيل الإجراء.',
    COMPLAINT_UNAVAILABLE:'تعذر العثور على الشكوى لهذا الطلب.',
    INVALID_COMPLAINT:'تحقق من الحقول ثم أعد المحاولة.',
    COMPLAINT_REMEDY_DENOMINATION_INVALID:'قيمة القسيمة يجب أن تكون من مضاعفات ٢٥٠ دينار. راجع المبلغ المعتمد.',
    COMPLAINT_REMEDY_REQUIRED:'اربط قسيمة التعويض قبل إغلاق الشكوى.',
    COMPLAINT_DECISION_REQUIRED:'أصدر القرار أو بتّ في الاعتراض قبل الإغلاق.',
    COMPLAINT_INDEPENDENT_EVIDENCE_REQUIRED:'يتطلب توزيع المسؤولية إفادتين من مصدرين مختلفين ونسبًا مجموعها ١٠٠٪.',
    COMPLAINT_EVIDENCE_REQUIRED:'اختر الأدلة التي يستند إليها القرار.',
    EXCEPTION_PERMISSION_REQUIRED:'حسابك لا يملك صلاحية هذا الإجراء.',
    EXCEPTION_APPROVAL_LIMIT:'المبلغ يتجاوز حد الاعتماد المالي لحسابك.',
    CUSTOMER_COMPENSATION_CASE_CHANGED:'تغيّرت الشكوى. أعد تحميل التفاصيل والقسائم.',
    CUSTOMER_COMPENSATION_VOUCHER_CHANGED:'تغيرت القسيمة. حدّث قائمة القسائم.',
    PERMISSION_REQUIRED:'حسابك لا يملك صلاحية التعويض.',
    ADMIN_MFA_REQUIRED:'يلزم تفعيل التحقق بخطوتين لحساب الإدارة.',
  };
  const formatDate = new Intl.DateTimeFormat('ar-IQ', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Baghdad'});
  const date = value => Number.isFinite(Date.parse(value)) ? formatDate.format(new Date(value)) : 'غير مسجّل';
  const iqd = value => new Intl.NumberFormat('ar-IQ').format(value) + ' د.ع';
  let selected = new URLSearchParams(location.search).get('order') || '';
  let cursor = null, listVersion = 0, detailVersion = 0, saving = false;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, handler) {
    const node = element('button', text, 'secondary');
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }
  function field(text, node) {
    const container = element('label', text);
    container.append(node);
    return container;
  }
  function select(options, prompt) {
    const node = element('select');
    if (prompt) node.append(new Option(prompt, ''));
    for (const [id, label] of Object.entries(options)) node.append(new Option(label, id));
    node.required = true;
    return node;
  }
  function textarea() {
    const node = element('textarea');
    Object.assign(node, {required:true, minLength:5, maxLength:2000, rows:3});
    return node;
  }
  async function request(query = {}, body, url = path, extraHeaders = {}) {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    if (!token) throw Error('انتهت جلسة الدخول.');
    const params = new URLSearchParams(query);
    const response = await fetch(url + (params.size ? '?' + params : ''), {
      method:body ? 'POST' : 'GET', signal:AbortSignal.timeout(27000), cache:'no-store',
      headers:{Authorization:'Bearer '+token, ...(body ? {'Content-Type':'application/json'} : {}), ...extraHeaders},
      ...(body ? {body:JSON.stringify(body)} : {}),
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(errors[value.code] || (response.status === 401 ?
      'انتهت جلسة الدخول. افتح المنصة وأعد المحاولة.' : 'تعذر إكمال الإجراء. أعد المحاولة.'));
    return value;
  }
  function fact(label, value) {
    const part = element('div');
    part.append(element('dt', label), element('dd', value));
    return part;
  }
  function box(title) {
    const section = element('section', null, 'complaints-box');
    section.append(element('h3', title));
    return section;
  }
  async function loadList(append = false) {
    const version = ++listVersion;
    byId('list-status').textContent = 'جارٍ تحميل الشكاوى…';
    byId('more').hidden = true;
    try {
      const response = await request({state:byId('state').value, ...(append && cursor ? {cursor} : {})});
      if (version !== listVersion) return;
      if (!append) byId('list').replaceChildren();
      cursor = response.cursor;
      for (const row of response.items) {
        const item = element('li');
        const open = button(null, () => loadDetail(row.orderId));
        open.dataset.order = row.orderId;
        if (row.orderId === selected) open.setAttribute('aria-current', 'true');
        open.append(element('bdi', row.orderNumber || row.orderId), element('span', (states[row.status] || 'محدّثة') + ' · ' + date(row.updatedAt)));
        item.append(open);
        byId('list').append(item);
      }
      byId('more').hidden = !cursor;
      byId('list-status').textContent = byId('list').children.length ? '' :
        (cursor ? 'يمكنك متابعة البحث في بقية السجلات.' : 'لا توجد شكاوى في هذه القائمة.');
    } catch (error) {
      if (version !== listVersion) return;
      byId('list-status').textContent = error.message;
      byId('more').hidden = !(append && cursor);
    }
  }
  async function loadDetail(orderId) {
    const version = ++detailVersion;
    selected = orderId;
    for (const node of byId('list').querySelectorAll('button')) {
      if (node.dataset.order === selected) node.setAttribute('aria-current','true');
      else node.removeAttribute('aria-current');
    }
    byId('detail').replaceChildren();
    byId('detail-status').textContent = 'جارٍ تحميل تفاصيل الشكوى…';
    try {
      const state = await request({orderId});
      if (version !== detailVersion) return;
      selected = state.case?.orderId || orderId;
      render(state);
      byId('detail-status').textContent = '';
    } catch (error) {
      if (version === detailVersion) byId('detail-status').textContent = error.message;
    }
  }
  async function submit(orderId, run, trigger) {
    if (saving) return;
    saving = true;
    trigger.disabled = true;
    byId('detail-status').textContent = 'جارٍ حفظ الإجراء…';
    try {
      await run();
      if (selected === orderId) {
        await loadDetail(orderId);
        if (!byId('detail-status').textContent) byId('detail-status').textContent = 'تم تسجيل الإجراء.';
      }
      await loadList();
    } catch (error) {
      if (selected === orderId) byId('detail-status').textContent = error.message;
    } finally {
      trigger.disabled = false;
      saving = false;
    }
  }
  async function preview(node, item, orderId) {
    node.disabled = true;
    try {
      const image = await request({orderId, attachmentId:item.attachmentId, view:'evidence'});
      if (image.attachmentId !== item.attachmentId || !['image/png','image/jpeg'].includes(image.contentType) ||
          !/^[A-Za-z0-9+/]+={0,2}$/.test(image.dataBase64)) throw Error('تعذّر عرض المرفق.');
      const result = element('img');
      result.src = 'data:'+image.contentType+';base64,'+image.dataBase64;
      result.alt = 'صورة مرفقة بالشكوى';
      node.replaceWith(result);
    } catch (error) {
      node.after(element('p', error.message));
      node.disabled = false;
    }
  }
  function reviewForm(state) {
    const row = state.case, form = element('form', null, 'complaints-review');
    const available = state.userOwnsCase ? ['ADD_EVIDENCE', ...(row.state === 'APPEAL_REVIEW' ? ['RESOLVE_APPEAL'] :
      ['REQUEST_INFO','DECIDE', ...(row.decisions.length ? ['CLOSE'] : [])]), 'RELEASE'] : ['CLAIM'];
    const action = select(Object.fromEntries(available.map(id => [id, actions[id]])), 'اختر إجراءً');
    const fields = element('div', null, 'complaints-review');
    const reason = textarea();
    const confirm = element('button', 'تسجيل الإجراء');
    let payload = () => ({});
    action.addEventListener('change', () => {
      fields.replaceChildren();
      payload = () => ({});
      if (action.value === 'ADD_EVIDENCE') {
        const source = select(sources, 'اختر مصدرًا'), reference = element('input');
        Object.assign(reference, {required:true, minLength:3, maxLength:500});
        fields.append(field('مصدر الإفادة', source), field('مرجع الإفادة', reference));
        payload = () => ({reportedBy:source.value, reference:reference.value.trim()});
      }
      if (['DECIDE','RESOLVE_APPEAL'].includes(action.value)) {
        const outcome = select(outcomes, 'اختر نتيجة'), publicReason = textarea();
        const scope = element('fieldset'), checks = [];
        scope.append(element('legend', 'الأدلة التي يستند إليها القرار'));
        for (const evidence of row.evidence) {
          const check = element('input');
          check.type = 'checkbox';
          scope.append(field((sources[evidence.source] || 'إفادة')+' · '+evidence.text, check));
          scope.lastChild.classList.add('complaints-check');
          checks.push({check,id:evidence.id});
        }
        const shares = element('fieldset');
        shares.append(element('legend','نسب المسؤولية عند ثبوتها'));
        const group = element('div', null, 'complaints-fields');
        const allocations = Object.entries(parties).map(([party, label]) => {
          const percent = element('input');
          Object.assign(percent, {type:'number', min:0, max:100, step:0.01, placeholder:'٪'});
          group.append(field(label, percent));
          return {party,percent};
        });
        shares.append(group);
        const amount = element('input');
        Object.assign(amount, {type:'number', min:0, max:1000000000, step:250, value:0});
        fields.append(field('النتيجة', outcome), field('التوضيح الذي يراه الزبون', publicReason), scope, shares);
        if (state.userCanApproveRemedy) {
          const amountLabel = field('قيمة قسيمة التعويض بالدينار العراقي', amount);
          amountLabel.hidden = true;
          fields.append(amountLabel);
          outcome.addEventListener('change', () => { amountLabel.hidden = outcome.value !== 'ACCEPTED'; });
        }
        payload = () => ({
          outcome:outcome.value, publicReason:publicReason.value.trim(), evidenceIds:checks.filter(x => x.check.checked).map(x => x.id),
          allocations:allocations.map(x => ({party:x.party,basisPoints:Math.round(Number(x.percent.value)*100)})).filter(x => x.basisPoints),
          remedyAmountIqd:outcome.value === 'ACCEPTED' ? Number(amount.value) : 0,
        });
      }
    });
    form.append(field('إجراء المراجعة', action), field('السبب أو نص الإفادة', reason), fields, confirm);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const extra = payload();
      submit(row.orderId, () => request({}, {action:action.value, orderId:row.orderId, expectedVersion:row.version,
        requestId:crypto.randomUUID(), reason:reason.value.trim(), ...extra}), confirm);
    });
    return form;
  }
  function voucherBox(row, decision) {
    const section = box('قسيمة التعويض');
    const load = button('عرض القسائم المتاحة', async () => {
      load.disabled = true;
      details.textContent = 'جارٍ التحقق من القسائم…';
      try {
        const reply = await request({view:'voucher',orderId:row.orderId});
        details.replaceChildren();
        if (reply.link) {
          const labels = {AVAILABLE:'متاحة',RESERVED:'محجوزة',USED:'مستخدمة',PAUSED:'موقوفة',EXPIRED:'منتهية',REVOKED:'ملغاة'};
          details.append(element('p', reply.link.title + ' · ' + iqd(reply.link.amountIqd) +
            ' · ' + (labels[reply.link.state] || 'غير متاحة')));
          return;
        }
        const items = reply.items.filter(item => item.amountIqd === decision.remedyAmountIqd);
        if (!items.length) {
          details.append(element('p','لا توجد قسيمة متاحة للزبون بالقيمة المعتمدة. أنشئ خصمًا ثابتًا على الأصناف بمنح مباشر، ثم حدّث القسائم هنا.'));
          const link = element('a','فتح مزايا الزبائن','button secondary');
          link.href = '/pages/benefits.html?' + new URLSearchParams({remedy:decision.remedyAmountIqd});
          link.target = '_blank';
          link.rel = 'noopener';
          details.append(link);
          return;
        }
        const form = element('form',null,'complaints-review');
        const choices = select(Object.fromEntries(items.map(item => [item.id, item.title+' · '+iqd(item.amountIqd)+' · حتى '+date(item.expiresAt)])), 'اختر قسيمة');
        const reason = textarea();
        reason.maxLength = 300;
        const save = element('button', 'ربط القسيمة بالشكوى');
        choices.disabled = !reply.canRecord;
        save.disabled = !reply.canRecord;
        form.append(field('القسيمة',choices),field('سبب الربط',reason),save);
        form.addEventListener('submit', event => {
          event.preventDefault();
          const chosen = items.find(item => item.id === choices.value);
          if (chosen) submit(row.orderId, () => request({view:'voucher'}, {orderId:row.orderId, caseId:row.caseId,
            expectedVersion:reply.version, campaignId:chosen.id, campaignRevision:chosen.campaignRevision,
            grantRevision:chosen.grantRevision, requestId:crypto.randomUUID(), reason:reason.value.trim()}), save);
        });
        details.append(form);
      } catch (error) { details.textContent = error.message; }
      finally { load.disabled = false; }
    });
    const details = element('div');
    details.setAttribute('role','status');
    section.append(load,details);
    return section;
  }
  function render(state) {
    const row = state.case;
    if (!row) return;
    const title = element('h2','شكوى طلب ');
    title.append(element('bdi',state.orderNumber || row.orderId));
    const facts = element('dl',null,'complaints-facts');
    facts.append(fact('نوع الشكوى',types[row.type] || 'شكوى طلب'), fact('وقت الإرسال',date(row.createdAt)),
      fact('موعد الرد · بغداد',date(row.activePhase?.responseDueAt)), fact('المراجع',row.ownerName || 'بانتظار تولّي المراجعة'));
    const report = box('بلاغ الزبون');
    report.append(element('p',row.description,'complaints-copy'));
    const evidence = box('الأدلة والإفادات'), list = element('ol',null,'complaints-evidence');
    for (const item of row.evidence) {
      const rowNode = element('li');
      rowNode.append(element('strong',(sources[item.source] || 'إفادة')+' · '+date(item.at)),
        element('p',item.text,'complaints-copy'));
      if (item.reference) rowNode.append(element('p',item.reference,'complaints-copy'));
      if (item.attachmentId) {
        const open = button('عرض الصورة', () => preview(open,item,row.orderId));
        rowNode.append(open);
      }
      list.append(rowNode);
    }
    evidence.append(list);
    byId('detail').append(title,element('span',states[row.state] || 'محدّثة','complaints-status'),facts,report,evidence);
    if (row.customerRequest) {
      const question = box('آخر طلب معلومات');
      question.append(element('p',row.customerRequest.text,'complaints-copy'));
      byId('detail').append(question);
    }
    const appeal = row.appeals.at(-1);
    if (appeal) {
      const section = box(appeal.status === 'OPEN' ? 'اعتراض الزبون' : 'اعتراض تمت مراجعته');
      section.append(element('p',appeal.reason,'complaints-copy'));
      byId('detail').append(section);
    }
    const decision = row.decisions.at(-1);
    if (decision) {
      const section = box('آخر قرار');
      section.append(element('p',(outcomes[decision.outcome] || 'قرار')+' · '+date(decision.at)),
        element('p',decision.publicReason,'complaints-copy'),element('p','سبب المراجعة الداخلي'),
        element('p',decision.internalReason,'complaints-copy'));
      if (decision.remedyAmountIqd) section.append(element('p','قسيمة تعويض بقيمة '+iqd(decision.remedyAmountIqd)));
      byId('detail').append(section);
      if (decision.remedyAmountIqd && state.userCanLinkVoucher) byId('detail').append(voucherBox(row,decision));
    }
    if (state.userCanReview && row.state !== 'CLOSED' && (state.userOwnsCase || !row.ownerId || state.ownerUnavailable)) {
      const section = box('إجراءات المراجعة');
      section.append(reviewForm(state));
      byId('detail').append(section);
    }
  }

  byId('refresh').addEventListener('click', () => { loadList(); if (selected) loadDetail(selected); });
  byId('state').addEventListener('change', () => loadList());
  byId('more').addEventListener('click', () => loadList(true));
  byId('search').addEventListener('submit', event => {
    event.preventDefault();
    const order = new FormData(event.currentTarget).get('order').trim();
    if (order) loadDetail(order);
  });
  loadList();
  if (selected) loadDetail(selected);
})();
