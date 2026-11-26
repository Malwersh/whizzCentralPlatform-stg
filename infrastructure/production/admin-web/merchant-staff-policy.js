(() => {
  'use strict';

  const byId = id => document.getElementById('staff-policy-' + id);
  const globalForm = byId('global');
  const roleForm = byId('role');
  const types = byId('types');
  const globalChecks = byId('global-capabilities');
  const roleChecks = byId('role-capabilities');
  const labels = {
    'menu.read': 'عرض المنتجات والأقسام',
    'menu.create': 'إضافة المنتجات',
    'menu.edit': 'تعديل اسم المنتج ووصفه وتصنيفه',
    'menu.delete': 'حذف المنتجات',
    'menu.price.write': 'تعديل أسعار المنتجات',
    'menu.availability.write': 'تغيير توفر المنتجات',
    'hours.read': 'عرض ساعات العمل',
    'hours.write': 'تعديل ساعات العمل',
    'discounts.read': 'عرض خصومات الفرع',
    'discounts.create': 'إنشاء خصم',
    'discounts.edit': 'تعديل خصم',
    'discounts.activate': 'تفعيل الخصم وإيقافه',
    'discounts.delete': 'حذف خصم',
    'orders.read': 'عرض طلبات الفرع',
    'orders.accept': 'قبول الطلبات',
    'orders.reject': 'رفض الطلبات',
    'orders.prepare': 'بدء تحضير الطلب',
    'orders.ready': 'تحديد الطلب جاهزًا للاستلام',
    'branch.read': 'عرض بيانات الفرع',
    'wallet.balance.read': 'عرض الرصيد',
    'wallet.transactions.read': 'عرض الحركات المالية',
    'reports.finance.read': 'عرض التقارير المالية',
    'wallet.settlements.read': 'عرض كشوف التسوية',
    'finance.payout.request': 'طلب صرف المستحقات',
    'finance.payout.receive': 'تأكيد استلام المستحقات',
  };
  const errors = {
    PERMISSION_REQUIRED: 'تحتاج صلاحية إدارة سياسة موظفي المطاعم.',
    VERSION_OR_STATE_CONFLICT: 'تغيّرت السياسة. حدّث الصفحة قبل الحفظ.',
    ROLE_VERSION_CONFLICT: 'تغيّر نوع الموظف. حدّث البيانات قبل الحفظ.',
    ROLE_NOT_READY: 'هذا النوع ينتظر تفعيل مهامه في الإنتاج.',
    ROLE_BUNDLE_REQUIRED: 'صلاحيات هذا النوع مرتبطة بحزمته المعتمدة.',
    PERMISSION_NOT_DELEGABLE: 'تتضمن السياسة صلاحية غير متاحة للتفويض.',
    DEPENDENCY_REQUIRED: 'تحقق من إتاحة صلاحيات القراءة اللازمة لكل إجراء.',
    INVALID_STAFF_POLICY_REQUEST: 'راجع البيانات واكتب سبب التغيير.',
    BRANCH_READ_REQUIRED: 'تفعيل النوع يتطلب صلاحية عرض بيانات الفرع.',
  };
  const num = new Intl.NumberFormat('ar-IQ');
  let state, busy = false, cursor = null;

  function feedback(value, error = false) {
    byId('message').textContent = value;
    byId('message').dataset.error = String(error);
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    byId('panel').setAttribute('aria-busy', 'true');
    const controls = byId('panel').querySelectorAll('button[type=submit], #staff-policy-history-load');
    for (const control of controls) control.disabled = true;
    try {
      await action();
    } catch (error) {
      if (error.code === 'PERMISSION_REQUIRED' || error.code === 'SessionExpired' || error.code === 'UNAUTHORIZED') {
        byId('workspace').hidden = true;
        byId('version').hidden = true;
      }
      feedback(errors[error.code] || error.message, true);
    } finally {
      busy = false;
      byId('panel').setAttribute('aria-busy', 'false');
      for (const control of controls) control.disabled = false;
    }
  }

  const checked = root => [...root.querySelectorAll('input:checked')].map(box => box.value);
  const presetFor = id => state.rolePresets.find(preset => preset.id === id);
  const available = role => role.enabled && role.permissions.every(id => state.current.enabledPermissions.includes(id));

  function renderChecks(root, selected, disabled) {
    const groups = new Map([
      ['branch', 'بيانات الفرع'], ['orders', 'الطلبات'], ['menu', 'المنتجات'],
      ['discounts', 'الخصومات'], ['hours', 'ساعات العمل'], ['finance', 'المالية'],
    ]);
    const sections = [];
    for (const [group, title] of groups) {
      const entries = state.capabilities.filter(capability => group === 'finance'
        ? ['wallet', 'reports', 'finance'].includes(capability.group)
        : capability.group === group);
      if (entries.length === 0) continue;
      const section = document.createElement('fieldset');
      const caption = document.createElement('legend');
      caption.textContent = title;
      section.append(caption);
      for (const capability of entries) {
        const label = document.createElement('label');
        label.className = 'staff-policy-choice';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = capability.id;
        input.checked = selected.includes(capability.id);
        input.disabled = disabled(capability.id);
        label.append(input, document.createTextNode(labels[capability.id] || capability.id));
        section.append(label);
      }
      sections.push(section);
    }
    root.replaceChildren(...sections);
  }

  function editRole(id) {
    const role = state.current.roles.find(item => item.id === id);
    const preset = presetFor(id);
    const supported = !preset?.pendingPermissions.length;
    const canEdit = state.canManage && supported;
    const fields = roleForm.elements;
    types.value = id;
    fields.nameAr.value = role?.nameAr || '';
    fields.nameEn.value = role?.nameEn || '';
    fields.description.value = role?.description || '';
    fields.order.value = role?.order ?? Math.max(0, ...state.current.roles.map(item => item.order + 1));
    fields.enabled.checked = role?.enabled ?? true;
    fields.reason.value = '';
    byId('role-fields').disabled = !canEdit;
    byId('role-actions').hidden = !canEdit;
    byId('role-status').textContent = !supported ? 'بانتظار تفعيل المهام التشغيلية.'
      : role && !role.enabled ? 'موقوف للتعيينات الجديدة.'
      : role && !available(role) ? 'بعض صلاحيات هذا النوع موقوفة ضمن السياسة الحالية.' : '';
    renderChecks(roleChecks, role?.permissions || [], value =>
      !canEdit || !!preset || !state.current.enabledPermissions.includes(value));
  }

  async function read(selected) {
    state = await request('/staff-policy');
    byId('workspace').hidden = !state.initialized;
    byId('version').hidden = !state.initialized;
    if (!state.initialized) {
      feedback('سياسة الموظفين غير متاحة حاليًا.', true);
      return;
    }
    byId('version').textContent = 'إصدار ' + num.format(state.current.version);
    byId('new').hidden = !state.canManage;
    byId('global-actions').hidden = !state.canManage;
    renderChecks(globalChecks, state.current.enabledPermissions, () => !state.canManage);
    globalForm.elements.reason.value = '';
    const roles = [...state.current.roles].sort((a, b) => a.order - b.order);
    types.replaceChildren(...roles.map(role => new Option(role.nameAr, role.id)));
    editRole(roles.some(role => role.id === selected) ? selected : roles[0]?.id || '');
    cursor = null;
    byId('history').replaceChildren();
    byId('history-load').hidden = false;
    byId('history-load').textContent = 'عرض السجل';
    feedback(state.canManage ? '' : 'حسابك مخوّل بعرض السياسة.');
  }

  async function save(values, reason, selected) {
    await request('/staff-policy/save', {body: {baseVersion: state.current.version, values, reason: reason.trim()}});
    await read(selected);
    feedback('حُفظت السياسة وسُجّل سبب التغيير.');
  }

  globalChecks.onchange = event => {
    const boxes = new Map([...globalChecks.querySelectorAll('input')].map(box => [box.value, box]));
    if (event.target.checked) {
      const enable = id => {
        boxes.get(id).checked = true;
        state.capabilities.find(cap => cap.id === id).requires.forEach(enable);
      };
      enable(event.target.value);
    } else {
      const disable = id => {
        boxes.get(id).checked = false;
        for (const cap of state.capabilities) {
          if (cap.requires.includes(id) && boxes.get(cap.id).checked) disable(cap.id);
        }
      };
      disable(event.target.value);
    }
  };

  types.onchange = () => editRole(types.value);
  byId('new').onclick = () => {
    if (busy) return;
    if (!types.querySelector('option[value=""]')) types.append(new Option('نوع جديد', ''));
    editRole('');
    roleForm.elements.nameAr.focus();
  };
  globalForm.onsubmit = event => {
    event.preventDefault();
    if (!state?.canManage) return;
    run(() => save({enabledPermissions: checked(globalChecks), roles: state.current.roles},
      globalForm.elements.reason.value, types.value));
  };
  roleForm.onsubmit = event => {
    event.preventDefault();
    if (!state?.canManage) return;
    run(async () => {
      const fields = roleForm.elements;
      const old = state.current.roles.find(item => item.id === types.value);
      const role = {
        id: old?.id || 'TYPE_' + crypto.randomUUID().replaceAll('-', ''),
        version: old?.version || 1,
        nameAr: fields.nameAr.value.trim(),
        nameEn: fields.nameEn.value.trim(),
        description: fields.description.value.trim(),
        order: Number(fields.order.value),
        enabled: fields.enabled.checked,
        permissions: checked(roleChecks),
      };
      if (role.enabled && !role.permissions.includes('branch.read')) throw Error(errors.BRANCH_READ_REQUIRED);
      if (old && Object.keys(role).some(key => JSON.stringify(old[key]) !== JSON.stringify(role[key]))) role.version++;
      const roles = old ? state.current.roles.map(item => item.id === old.id ? role : item) : [...state.current.roles, role];
      await save({enabledPermissions: state.current.enabledPermissions, roles}, fields.reason.value, role.id);
    });
  };
  byId('history-load').onclick = () => run(async () => {
    const page = await request('/staff-policy/history', {query: cursor ? {cursor} : undefined});
    for (const item of page.items) {
      const line = document.createElement('li');
      const date = new Intl.DateTimeFormat('ar-IQ', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad'});
      line.textContent = ['إصدار ' + num.format(item.version), date.format(new Date(item.updatedAt)), item.reason].join(' · ');
      byId('history').append(line);
    }
    if (!page.items.length && !cursor) {
      const line = document.createElement('li');
      line.textContent = 'لا توجد تغييرات مسجّلة.';
      byId('history').append(line);
    }
    cursor = page.nextCursor;
    byId('history-load').hidden = !cursor;
    byId('history-load').textContent = 'عرض المزيد';
  });

  window.MerchantStaffPolicy = {load: () => run(async () => {
    feedback('جارٍ تحميل السياسة…');
    await read(types.value);
  })};
})();
