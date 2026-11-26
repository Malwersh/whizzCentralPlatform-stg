'use strict';

(() => {
  const bases = {
    GOODS_GROSS: 'قيمة السلع قبل الخصومات',
    AFTER_MERCHANT_DISCOUNT: 'قيمة السلع بعد خصم المطعم',
    CUSTOMER_GOODS_PAYMENT: 'ما يدفعه الزبون مقابل السلع',
  };
  const messages = {
    OWNER_ACCEPTANCE_REQUIRED: 'ينتظر الطلب موافقة المالك على هذه النسخة.',
    REQUESTER_PERMISSION_REVOKED: 'تغيّرت صلاحيات مُعدّ الاتفاقية. راجعها قبل الاعتماد.',
    BUSINESS_UNAVAILABLE: 'لم يعد الفرع متاحًا لهذه العملية.',
    AGREEMENT_START_NOT_REACHED: 'لم يبدأ سريان الاتفاقية بعد. يمكنك اعتمادها عند حلول الموعد.',
    COMMERCIAL_PERIOD_EXPIRED: 'انتهت فترة الاتفاقية. أعد إعداد مدة صالحة.',
    INVALID_COMMERCIAL_CHARGE: 'تحقق من مبلغ الرسوم ونسبتها وأساس الاحتساب.',
    INVALID_COMMERCIAL_PERIOD: 'اختر نهاية تلي بداية السريان.',
    VERSION_OR_STATE_CONFLICT: 'تغيّرت النسخة أو حالة الفرع. حدّث الاتفاقيات وأعد المحاولة.',
  };
  function field(label, control) {
    const row = el('label', label);
    row.append(control);
    return row;
  }
  function select(options, current) {
    const node = Object.assign(el('select'), { required: true });
    for (const [value, label] of Object.entries(options)) node.add(new Option(label, value, false, value === current));
    return node;
  }
  function chargeText(charge) {
    if (charge.kind === 'NONE') return 'دون رسوم';
    if (charge.kind === 'FIXED') return new Intl.NumberFormat('ar-IQ').format(charge.fixed.minorAmount / 1000) + ' د.ع';
    return new Intl.NumberFormat('ar-IQ').format(charge.rate.numerator * 100 / charge.rate.denominator) +
      '٪ من ' + bases[charge.basis];
  }
  function chargeFields(label, initial) {
    const node = el('fieldset');
    const kind = select({ '': 'اختر طريقة الاحتساب', NONE: 'دون رسوم', FIXED: 'مبلغ ثابت', PERCENT: 'نسبة مئوية' }, initial?.kind || '');
    const basis = select(bases, initial?.basis || 'GOODS_GROSS');
    const amount = Object.assign(el('input'), { type: 'number', inputMode: 'decimal', min: '0' });
    const amountField = field('القيمة', amount);
    const basisField = field('أساس النسبة', basis);
    function update() {
      const percent = kind.value === 'PERCENT';
      const applies = percent || kind.value === 'FIXED';
      amountField.firstChild.textContent = percent ? 'النسبة المئوية' : 'المبلغ بالدينار';
      amountField.hidden = !applies;
      amount.required = applies;
      amount.step = percent ? '0.01' : '1';
      amount.max = percent ? '100' : '1000000000';
      basisField.hidden = !percent;
      basis.disabled = !percent;
    }
    node.append(el('legend', label), field('طريقة الاحتساب', kind), amountField, basisField);
    kind.onchange = () => { amount.value = ''; update(); };
    if (initial?.kind === 'FIXED') amount.value = initial.fixed.minorAmount / 1000;
    if (initial?.kind === 'PERCENT') amount.value = initial.rate.numerator * 100 / initial.rate.denominator;
    update();
    return {
      node, value() {
        const percent = kind.value === 'PERCENT';
        return {
          kind: kind.value, basis: percent ? basis.value : null,
          fixed: kind.value === 'FIXED' ? { currency: 'IQD', scale: 1000, moneySchemaVersion: 1,
            minorAmount: Number(amount.value) * 1000 } : null,
          rate: percent ? { numerator: Math.round(Number(amount.value) * 100), denominator: 10000 } : null,
          rounding: percent ? 'HALF_AWAY_FROM_ZERO' : 'EXACT',
          finalRounding: { incrementIqd: 1, mode: 'HALF_AWAY_FROM_ZERO' },
        };
      },
    };
  }

  const local = iso => new Date(Date.parse(iso) + 10800000).toISOString().slice(0, 16);
  const iso = string => new Date(string + '+03:00').toISOString();
  const reasonInput = () => Object.assign(el('textarea'), { required: true, minLength: 5, maxLength: 300, rows: 2 });
  function statusOf(item) {
    if (item.draft.publishedVersion) {
      return 'معتمدة · الإصدار ' + item.draft.publishedVersion;
    }
    return item.ownerAccepted ? 'وافق المالك · بانتظار اعتماد الإدارة' : 'بانتظار قبول المالك';
  }

  async function render(panel, branch, message = '') {
    const heading = el('h3', 'الاتفاقيات التجارية');
    const notice = el('p', 'جارٍ تحميل الاتفاقيات…');
    notice.setAttribute('role', 'status');
    const headingRow = el('div', undefined, 'merchant-header');
    headingRow.append(heading, button('تحديث الاتفاقيات', () => render(panel, branch)));
    panel.replaceChildren(headingRow, notice);
    try {
      const state = await request('/agreements', { query: { businessId: branch.businessId } });
      let actionId, actionBody;
      async function commit(form, button, record, success) {
        const signature = JSON.stringify(record);
        if (actionBody !== signature) {
          actionBody = signature;
          actionId = crypto.randomUUID();
        }
        button.disabled = true;
        notice.textContent = 'جارٍ تسجيل العملية…';
        try {
          await request('/agreements', { body: { businessId: branch.businessId, ...record, requestId: actionId } });
          await render(panel, branch, success);
        } catch (error) {
          notice.textContent = messages[error.code] || error.message;
          if (form.isConnected) button.disabled = false;
        }
      }
      const editor = el('div');
      const names = new Map(state.branches.map(row => [row.id, row.name]));
      const displayBranches = ids => ids.map(id => names.get(id) || 'فرع مسجّل').join('، ');
      function edit(item) {
        const draft = item?.draft;
        const values = draft?.values;
        const form = el('form', undefined, 'merchant-agreement-editor');
        const commission = chargeFields('عمولة المنصة', values?.commission);
        const fee = chargeFields('رسم الخدمة على الزبون', values?.serviceFee);
        const start = Object.assign(el('input'), { type: 'datetime-local', required: true,
          value: local(item?.draft?.publishedVersion ? new Date().toISOString() : values?.effectiveFrom || new Date().toISOString()) });
        const end = Object.assign(el('input'), { type: 'datetime-local', value: !draft?.publishedVersion && values?.effectiveTo ? local(values.effectiveTo) : '' });
        const scope = select({ BRANCH: 'هذا الفرع', MERCHANT: 'فروع مختارة من المؤسسة' }, values?.scope || 'BRANCH');
        const branchChoices = el('fieldset');
        branchChoices.append(el('legend', 'الفروع المشمولة'));
        const checked = [];
        for (const b of state.branches) {
          const check = Object.assign(el('input'), { type: 'checkbox', value: b.id,
            checked: b.id === branch.businessId || draft?.businessIds.includes(b.id),
            disabled: b.id === branch.businessId || Boolean(draft) });
          const label = el('label', undefined, 'merchant-agreement-choice');
          label.append(check, el('span', b.name));
          branchChoices.append(label);
          checked.push(check);
        }
        scope.disabled = Boolean(draft);
        const scopeChanged = () => { branchChoices.hidden = scope.value !== 'MERCHANT'; };
        scope.onchange = scopeChanged;
        scopeChanged();
        const reason = reasonInput();
        const save = Object.assign(el('button', 'إرسال الشروط إلى المالك'), { type: 'submit' });
        const id = draft?.id || crypto.randomUUID();
        form.append(el('h4', draft ? 'إعداد نسخة من الاتفاقية' : 'اتفاقية جديدة'),
          field('نطاق الاتفاقية', scope), branchChoices, commission.node, fee.node,
          field('بداية السريان · بغداد', start), field('نهاية السريان · بغداد', end),
          field('سبب الإعداد', reason), save, button('إلغاء', () => editor.replaceChildren()));
        form.onsubmit = event => {
          event.preventDefault();
          const businessIds = scope.value === 'BRANCH' ? [branch.businessId]
            : checked.filter(option => option.checked).map(option => option.value);
          if (businessIds.length > 10) {
            notice.textContent = 'اختر حتى عشرة فروع لهذه الاتفاقية.';
            return;
          }
          commit(form, save, {
            action: 'SAVE_AGREEMENT', id, businessIds, draftVersion: draft?.version || 0,
            baseVersion: item?.current?.version || 0, reason: reason.value.trim(),
            values: { scope: scope.value, effectiveFrom: iso(start.value), effectiveTo: end.value ? iso(end.value) : null,
              commission: commission.value(), serviceFee: fee.value(), allowedFundingPolicyIds: [] },
          }, 'حُفظت الشروط وأصبحت متاحة للمالك في تطبيق المطعم.');
        };
        editor.replaceChildren(form);
        form.scrollIntoView({ block: 'nearest' });
      }
      function approve(item, target) {
        const form = el('form', undefined, 'merchant-agreement-editor');
        const reason = reasonInput();
        const publish = Object.assign(el('button', 'تأكيد الاعتماد'), { type: 'submit' });
        form.append(field('سبب الاعتماد', reason), publish, button('رجوع', () => target.replaceChildren()));
        form.onsubmit = event => {
          event.preventDefault();
          const { draft } = item;
          commit(form, publish, { action: 'APPROVE_AGREEMENT', id: draft.id, draftVersion: draft.version,
            baseVersion: draft.baseVersion, hash: draft.hash, reason: reason.value.trim() }, 'اعتُمد إصدار الاتفاقية وربط بالفروع المشمولة.');
        };
        target.replaceChildren(form);
        reason.focus();
      }
      notice.textContent = message;
      if (!state.items.length) panel.append(el('p', 'لا توجد اتفاقيات تجارية لهذا الفرع.'));
      for (const item of state.items) {
        const card = el('article', undefined, 'merchant-agreement-card');
        const { draft, current } = item;
        const pending = !draft.publishedVersion;
        const values = draft.values;
        card.append(el('strong', statusOf(item)), details([
          ['عمولة المنصة', chargeText(values.commission)], ['رسم الخدمة', chargeText(values.serviceFee)],
          ['الفروع', displayBranches(draft.businessIds)], ['بداية السريان', date(values.effectiveFrom)],
          ['نهاية السريان', date(values.effectiveTo) || 'دون تاريخ انتهاء'],
        ]));
        if (current && pending && current.disclosure?.values) {
          const previous = el('details');
          const saved = current.disclosure.values;
          previous.append(el('summary', 'الشروط المعتمدة حاليًا · الإصدار ' + current.version), details([
            ['عمولة المنصة', chargeText(saved.commission)], ['رسم الخدمة', chargeText(saved.serviceFee)],
          ]));
          card.append(previous);
        }
        if (state.can.request) card.append(button(pending ? 'تعديل الشروط' : 'إعداد نسخة جديدة', () => edit(item)));
        if (pending && item.ownerAccepted && state.can.approve) {
          if (Date.parse(values.effectiveFrom) > Date.now()) card.append(el('p', messages.AGREEMENT_START_NOT_REACHED));
          else {
            const confirmation = el('div');
            card.append(button('اعتماد الاتفاقية', () => approve(item, confirmation)), confirmation);
          }
        }
        panel.append(card);
      }
      if (state.can.request && !state.items.length) panel.append(button('إعداد اتفاقية', () => edit(null)));
      panel.append(editor);
    } catch (error) {
      notice.textContent = messages[error.code] || error.message;
      panel.append(button('إعادة التحميل', () => render(panel, branch)));
    }
  }
  window.MerchantCommercial = { render };
})();
