'use strict';

const $ = id => document.getElementById(id);
const paths = { applications: '/applications', branches: '/directory', changes: '/changes', lifecycle: '/lifecycle' };
const data = { applications: { items: [] }, branches: { items: [] }, changes: { items: [] }, lifecycle: { items: [] }, 'staff-policy': {} };
const tabs = Object.keys(data);
const dialog = $('merchant-detail');
const errors = {
  PERMISSION_REQUIRED: 'حسابك لا يملك صلاحية هذا الإجراء.',
  ADMIN_MFA_REQUIRED: 'فعّل التحقق الثنائي لحساب الإدارة ثم أعد المحاولة.',
  APPLICATION_UNAVAILABLE: 'هذا الطلب لم يعد متاحًا للمراجعة.',
  REQUEST_UNAVAILABLE: 'هذا الطلب لم يعد متاحًا للمراجعة.',
  CHANGE_BASE_CONFLICT: 'تغيّرت بيانات الفرع منذ إرسال الطلب. اطلب من المالك تقديم طلب جديد.',
  REGION_CHANGED_RETRY: 'تغيّرت حدود المنطقة أثناء المراجعة. حدّث الطلب وأعد المحاولة.',
  ASSET_UNAVAILABLE: 'تعذر فتح المستند. حدّث الطلب وتحقق من توفره.',
  VERSION_OR_STATE_CONFLICT: 'تغيّر الطلب في نافذة أخرى. حدّث القائمة قبل تسجيل القرار.',
  SUBMISSION_EVIDENCE_REQUIRED: 'تعذّر مطابقة نسخة الاتفاقية المقبولة مع الطلب المرسل.',
  LOCATION_OUTSIDE_REGION: 'موقع الفرع خارج منطقة الخدمة الحالية. اطلب تصحيح الموقع.',
  REGION_UNAVAILABLE: 'منطقة الفرع لم تعد متاحة. اطلب تحديث بيانات المنطقة.',
  REGION_DELIVERY_UNAVAILABLE: 'التوصيل غير متاح في المنطقة الحالية للفرع.',
  INVALID_REVIEW: 'اختر القرار واكتب سببًا واضحًا من خمس حروف على الأقل.',
  INVALID_CONTROL_REQUEST: 'اختر إجراءً واكتب سببًا من خمسة أحرف على الأقل.',
  INVALID_TRANSFER_REVIEW: 'اختر القرار واكتب سببًا من خمسة أحرف على الأقل.',
  TRANSFER_DESTINATION_VERIFICATION_REQUIRED: 'يحتاج المالك الجديد إلى تأكيد هاتف التسويات قبل الاعتماد.',
  TRANSFER_SETTLEMENT_EVIDENCE_INVALID: 'تعذّر التحقق من سجل الاعتماد. راجع فريق تشغيل المنصة.',
  TRANSFER_APPROVAL_IN_PROGRESS: 'يوجد اعتماد جارٍ لهذا الطلب. حدّث الحالة بعد قليل.',
  TRANSFER_BRANCH_ALREADY_LOCKED: 'أحد الفروع ضمن إجراء جارٍ. تحقّق من حالته ثم أعد الفحص.',
  TRANSFER_ACTIVE_ACCESS: 'ما زالت هناك صلاحيات أو أجهزة مرتبطة. أعد فحص الموانع.',
  TRANSFER_FINANCIAL_BLOCKERS: 'تغيّرت البيانات المالية أثناء الاعتماد. أعد فحص الموانع.',
  TRANSFER_FINANCE_REVISION_INVALID: 'تعذّر مطابقة سجل الصرف. راجع فريق التسويات.',
  TRANSFER_SETTLEMENT_APPROVAL_REQUIRED: 'اعتمد وجهة التسويات قبل إكمال نقل الملكية.',
  TRANSFER_SCOPE_EXCEEDS_TRANSACTION_LIMIT: 'يتجاوز عدد الفروع والعلامات سعة الاعتماد دفعة واحدة. أحِل الطلب إلى فريق تشغيل المنصة.',
  TRANSFER_BRAND_INVENTORY_REQUIRED: 'تعذّر مطابقة العلامات التجارية للطلب. راجع ملف المؤسسة.',
  TRANSFER_SCOPE_CHANGED: 'تغيّر نطاق الطلب. راجع الفروع والمالك ثم اطلب دعوة جديدة عند الحاجة.',
  TRANSFER_PLATFORM_SCOPE_CHANGED: 'تغيّرت بيانات المؤسسة. راجع نطاق الطلب.',
  BRANCH_OWNERSHIP_CHANGED: 'تغيّرت ملكية أحد الفروع. حدّث الطلب.',
  ORGANIZATION_OWNERSHIP_CHANGED: 'تغيّرت ملكية المؤسسة. حدّث الطلب.',
  TRANSFER_EXPIRED: 'انتهت صلاحية الدعوة. اطلب إرسال دعوة جديدة.',
  TRANSFER_STATE_CHANGED: 'تغيّرت حالة الطلب. حدّث القائمة.',
  TRANSFER_MUTATION_FENCE_REQUIRED: 'تعذّر تثبيت بيانات الفروع أثناء الاعتماد. أعد الفحص قبل المحاولة.',
  TRANSFER_RECIPIENT_PROFILE_REQUIRED: 'تعذّر التحقق من ملف المالك الجديد. اطلب منه مراجعة بيانات حسابه.',
  TRANSFER_NOT_FOUND: 'تعذّر العثور على الطلب في حالته الحالية. حدّث القائمة.',
  TRANSFER_INVENTORY_INCOMPLETE: 'لم يكتمل فحص بيانات الفرع. أحِل الطلب إلى فريق تشغيل المنصة.',
  TRANSFER_CHECK_UNAVAILABLE: 'تعذّر فحص البيانات الحالية. أعد الفحص لاحقًا.',
  BRANCH_UNAVAILABLE: 'هذا الفرع غير متاح ضمن صلاحيات حسابك.',
  BRANCH_LIFECYCLE_LOCKED: 'تعذّر تغيير حالة الفرع أثناء إجراءات دورة الحساب أو نقل الملكية.',
  UNAUTHORIZED: 'انتهت جلسة الإدارة. سجّل الدخول مجددًا.',
};
const labels = {
  ACTIVE: 'سارية', UNASSIGNED: 'بانتظار ربط اتفاقية', SCHEDULED: 'مجدولة',
  REVIEW_REQUIRED: 'تحتاج مراجعة', EXPIRED: 'انتهت',
};
const typeLabels = { RESTAURANT: 'مطعم', MARKET: 'أسواق', RETAIL: 'متجر' };
const weekdays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
let tab = 'applications', loading = false, deciding = false, selectedRequest, selectedChange, dialogRequest = 0;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, action) {
  const item = el('button', text, 'merchant-secondary');
  item.type = 'button';
  item.onclick = action;
  return item;
}

function notify(id, text, error = false) {
  $(id).textContent = text;
  $(id).dataset.error = String(error);
}

const date = value => value && new Intl.DateTimeFormat('ar-IQ', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad',
}).format(new Date(value));

async function request(path, { body, query } = {}) {
  await window.Auth.ensureSession();
  const access = window.Auth.getToken('accessToken');
  if (!access) throw Error(errors.UNAUTHORIZED);
  const target = '/staff/merchants' + path + (query ? '?' + new URLSearchParams(query) : '');
  const response = await fetch(target, {
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { Authorization: 'Bearer ' + access, ...(body && { 'Content-Type': 'application/json' }) },
    cache: 'no-store', signal: AbortSignal.timeout(20000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(
    Error(errors[result.error] || (response.status === 401 ? errors.UNAUTHORIZED : 'تعذّر إكمال العملية. أعد المحاولة.')),
    { code: result.error },
  );
  return result;
}

function branchStatus(item) {
  if (item.platformSuspended || item.status === 'suspended' || item.operatingStatus === 'SUSPENDED') {
    return ['معلّق من المنصة', false];
  }
  if (item.ordersBlocked) return ['الطلبات الجديدة ممنوعة', false];
  if (item.active && item.acceptingOrders) return ['يستقبل الطلبات', true];
  return [item.onboardingComplete ? 'استقبال الطلبات متوقف' : 'بانتظار تجهيز الفرع', false];
}

function render(name) {
  const list = $(name + '-list');
  const { items, nextCursor } = data[name];
  $(name + '-more').hidden = !nextCursor;
  list.replaceChildren();
  if (!items.length) list.append(el('p', nextCursor ? 'لا توجد نتائج في هذه الصفحة.' :
    name === 'branches' ? 'لا توجد فروع مسجّلة ضمن صلاحياتك.' :
    name === 'lifecycle' ? (data[name].kind === 'closure' ? 'لا توجد طلبات إغلاق أو حذف حساب مسجّلة.' : 'لا توجد طلبات نقل ملكية مفتوحة.')
      : 'لا توجد طلبات بانتظار المراجعة.'));
  for (const row of items) {
    const line = el('article', undefined, 'merchant-row');
    const description = el('div');
    const action = el('div');
    if (name === 'changes') {
      description.append(el('h3', row.businessName), el('p', changeType(row)));
      action.append(el('span', date(row.createdAt), 'merchant-badge'), button('عرض التعديل', () => viewChange(row)));
    } else if (name === 'lifecycle') {
      const title = lifecycleTitle(row);
      description.append(el('h3', title));
      if (row.kind === 'ownership') description.append(el('p', formatNumber(row.branchCount) + ' من الفروع المشمولة'));
      action.append(el('span', lifecycleStatuses[row.status] || 'حالة تحتاج مراجعة', 'merchant-badge'),
        button('عرض تفاصيل الطلب', () => row.kind === 'ownership' ? viewTransfer(row) : viewClosure(row)));
    } else if (name === 'applications') {
      description.append(el('h3', row.name), el('p', [typeLabels[row.type] || row.type, row.region].filter(Boolean).join(' · ')));
      action.append(el('span', date(row.submittedAt), 'merchant-badge'), button('عرض الطلب', () => viewRequest(row)));
    } else {
      description.append(el('h3', row.name), el('p', [typeLabels[row.type] || row.type, row.region].filter(Boolean).join(' · ')));
      const [status, live] = branchStatus(row);
      const badge = el('span', status, 'merchant-badge');
      badge.dataset.live = String(live);
      action.append(badge, button('ملف الفرع', () => viewBranch(row)));
    }
    line.append(description, action);
    list.append(line);
  }
}

async function load(more = false, message = '') {
  if (tab === 'staff-policy') {
    await window.MerchantStaffPolicy.load();
    data['staff-policy'].loaded = true;
    return;
  }
  if (loading) return;
  loading = true;
  const name = tab;
  $('merchant-refresh').disabled = true;
  $(name + '-more').disabled = true;
  if (name === 'lifecycle') $('lifecycle-kind').disabled = true;
  notify('merchant-notice', 'جارٍ تحميل البيانات…');
  try {
    const cursor = more ? data[name].nextCursor : null;
    const kind = name === 'lifecycle' && data[name].kind;
    const query = { ...(cursor && { cursor }), ...(kind && { kind }) };
    const page = await request(paths[name], { query: Object.keys(query).length ? query : undefined });
    data[name] = { ...page, items: more ? [...data[name].items, ...page.items] : page.items };
    if (name === 'lifecycle') {
      const select = $('lifecycle-kind');
      select.value = page.kind;
      const choices = Object.values(page.available).filter(Boolean).length;
      $('lifecycle-filter').hidden = choices < 2;
    }
    render(name);
    data[name].loaded = true;
    if (tab === name) notify('merchant-notice', message);
  } catch (error) {
    if (tab === name) notify('merchant-notice', error.code === 'SessionExpired' ? errors.UNAUTHORIZED : error.message, true);
  } finally {
    loading = false;
    $('merchant-refresh').disabled = false;
    $(name + '-more').disabled = false;
    if (name === 'lifecycle') $('lifecycle-kind').disabled = false;
    if (tab !== name && !data[tab].loaded) load();
  }
}

function switchTab(name) {
  tab = name;
  for (const key of tabs) {
    const active = key === name;
    $(key + '-tab').setAttribute('aria-selected', String(active));
    $(key + '-tab').tabIndex = active ? 0 : -1;
    $(key + '-panel').hidden = !active;
  }
  const url = new URL(location.href);
  if (tab !== 'applications') url.searchParams.set('tab', tab);
  else url.searchParams.delete('tab');
  if (tab !== 'branches') url.searchParams.delete('branchId');
  history.replaceState(null, '', url);
  notify('merchant-notice', '');
  if (!data[name].loaded) load();
}
for (const name of tabs) {
  const control = $(name + '-tab');
  control.onclick = () => switchTab(name);
  control.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const offset = event.key === 'ArrowLeft' ? 1 : -1;
    const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1)
      : tabs[(tabs.indexOf(name) + offset + tabs.length) % tabs.length];
    $(next + '-tab').focus();
    switchTab(next);
  };
  if ($(name + '-more')) $(name + '-more').onclick = () => load(true);
}

function details(fields) {
  const group = el('dl');
  for (const [label, value] of fields) {
    if (!value) continue;
    const row = el('div');
    row.append(el('dt', label), el('dd', value));
    group.append(row);
  }
  return group;
}

function showDetail(title, content) {
  $('merchant-title').textContent = title;
  $('merchant-summary').replaceChildren(content);
  $('merchant-documents').replaceChildren();
  $('merchant-decision').hidden = true;
  $('merchant-change-decision').hidden = true;
  if (!dialog.open) dialog.showModal();
}

const lifecycleStatuses = {
  AWAITING_RECIPIENT: 'بانتظار قبول المالك الجديد', AWAITING_REVIEW: 'بانتظار مراجعة الإدارة',
  REJECTED: 'مرفوض', CANCELLED: 'ملغى', COMPLETED: 'اكتمل الإجراء', EXPIRED: 'منتهي الصلاحية',
  READY: 'جاهز للتنفيذ', PROCESSING: 'جارٍ التنفيذ', RETRY_REQUIRED: 'بانتظار إعادة المحاولة',
  PENDING_SETTLEMENT: 'بانتظار معالجة الموانع', PENDING_POLICY: 'بانتظار تجهيز التنفيذ',
  PENDING_EXTERNAL_ASSET: 'بانتظار معالجة الملفات الخارجية',
};
const lifecycleTitle = row => row.kind === 'ownership' ? (row.name || 'طلب نقل ملكية')
  : ({ BUSINESS: row.name ? 'إغلاق ' + row.name : 'إغلاق فرع', ACCOUNT: 'حذف حساب مالك', MEMBERSHIP: 'إزالة عضوية' })[row.scope];
const formatNumber = value => new Intl.NumberFormat('ar-IQ').format(value);
const recordedDate = value => Number.isFinite(new Date(value).getTime()) && value ? date(value) : null;
const financePage = '/pages/merchant-settlements.html#completed-order-settlements';
const walletPage = '/pages/wallets.html#wallets';
const ordersPage = '/pages/order-monitoring.html#orders-title';

const guidance = {
  TRANSFER_DESTINATION_VERIFICATION_REQUIRED: ['ينتظر تأكيد هاتف التسويات', 'المالك الجديد يؤكد هاتف التسويات من تفاصيل الدعوة في تطبيق المطعم. أعد الفحص بعد التأكيد.'],
  TRANSFER_SETTLEMENT_APPROVAL_REQUIRED: ['وجهة التسويات تحتاج اعتمادًا', 'المراجع المالي يطابق وجهة التسويات المؤكدة ضمن مسار نقل الملكية.'],
  BRANCH_SCOPE_CHANGED: ['تغيّرت الفروع أو شروط النقل', 'راجع ملف الفرع وتحقق من المالك الحالي ونطاق الدعوة، ثم اطلب دعوة محدّثة عند الحاجة.', 'branch', 'فتح ملف الفرع'],
  ACTIVE_ORDERS: ['طلبات قائمة', 'فريق التشغيل يتابع طلبات الفرع حتى اكتمالها أو إغلاقها وفق حالتها.', ordersPage, 'فتح متابعة الطلبات'],
  ACTIVE_HOLDS: ['حجوزات مالية قائمة', 'المراجع المالي يطابق الحجز مع الطلب أو العملية المرتبطة به ويعالجها من مسارها.', walletPage, 'فتح المحافظ'],
  WALLET_LOCKED: ['رصيد محجوز', 'المراجع المالي يتتبّع العملية التي حجزت المبلغ ويعالجها عبر مسار التسوية.', walletPage, 'فتح المحافظ'],
  LOCKED_BALANCE: ['رصيد محجوز', 'المراجع المالي يتتبّع العملية التي حجزت المبلغ ويعالجها عبر مسار التسوية.', walletPage, 'فتح المحافظ'],
  WALLET_BALANCE: ['رصيد يحتاج تسوية', 'المراجع المالي يطابق الرصيد ويستكمل الصرف أو التحصيل وفق نتيجة المطابقة.', financePage, 'فتح حسابات المطاعم والصرف'],
  REFUND_REQUIRED: ['رصيد يحتاج صرفًا', 'المراجع المالي يطابق الرصيد ويتابع الصرف للمالك الحالي.', financePage, 'فتح حسابات المطاعم والصرف'],
  AMOUNT_DUE: ['مبلغ مستحق للتحصيل', 'المراجع المالي يطابق الرصيد ويستكمل تحصيل المبلغ عبر المسار المعتمد.', financePage, 'فتح حسابات المطاعم والصرف'],
  PENDING_TOPUPS: ['طلبات شحن معلّقة', 'مراجع الشحن يطابق التحويل مع الوصل ويسجّل نتيجة المراجعة.', '/pages/wallets.html#topups', 'فتح طلبات الشحن'],
  PENDING_PAYMENTS: ['عمليات دفع أو شحن معلّقة', 'المراجع المالي يحدّد نوع العملية ويستكمل المطابقة من صفحة الصرف أو مراجعة الشحن.', financePage, 'فتح حسابات المطاعم والصرف'],
  PENDING_TRANSFERS: ['تحويلات معلّقة', 'المراجع المالي يراجع سجل المحفظة ويتحقق من نتيجة التحويل.', walletPage, 'فتح المحافظ'],
  PENDING_PAYOUTS: ['عمليات صرف معلّقة', 'فريق التسويات يراجع طلب الصرف ويثبت نتيجة الدفع والمطابقة.', financePage, 'فتح حسابات المطاعم والصرف'],
  PENDING_CORRECTIONS: ['تصحيحات مالية معلّقة', 'فريق التسويات يراجع حالة التصحيح ويعالج أي حجز تابع له.', financePage, 'فتح حسابات المطاعم والصرف'],
  ACTIVE_MEMBERSHIPS: ['عضويات موظفين نشطة', 'المالك الحالي يسحب العضويات النشطة من إدارة موظفي الفرع في تطبيق المطعم.', 'branch', 'فتح ملف الفرع'],
  PENDING_STAFF_INVITATIONS: ['دعوات موظفين معلّقة', 'المالك الحالي يلغي الدعوات غير المقبولة من تطبيق المطعم أو ينتظر انتهاءها.', 'branch', 'فتح ملف الفرع'],
  ACTIVE_DEVICES: ['أجهزة استقبال مرتبطة', 'المالك الحالي يلغي ربط أجهزة الاستقبال من إدارة أجهزة الفرع في التطبيق.', 'branch', 'فتح ملف الفرع'],
  PENDING_DEVICE_PAIRING: ['رمز ربط جهاز سارٍ', 'المالك الحالي يوقف إجراء الربط وينتظر انتهاء صلاحية الرمز قبل إعادة الفحص.', 'branch', 'فتح ملف الفرع'],
  ACTIVE_FINANCIAL_GRANTS: ['تفويضات مالية نشطة', 'المالك الحالي يسحب تفويضات الفرع من إدارة الصلاحيات المالية في تطبيق المطعم.', financePage, 'فتح القسم المالي'],
  WALLET_EVIDENCE_UNAVAILABLE: ['تعذّر التحقق من سجل المحفظة', 'المراجع المالي يتحقق من تطابق المحفظة مع الفرع ويُحيل أي نقص إلى فريق المحفظة.', walletPage, 'فتح المحافظ'],
  OWNED_BUSINESSES: ['فروع ما زالت على حساب المالك', 'المالك يستكمل إغلاق كل فرع أو نقل ملكيته من التطبيق قبل حذف حسابه.', '/pages/merchants.html?tab=branches', 'فتح الفروع المسجّلة'],
  EXTERNAL_ASSET_ACCESS_REQUIRED: ['ملفات تتطلب مراجعة', 'فريق تشغيل المنصة يتحقق من إمكانية معالجة الملفات القديمة.'],
  QUALITY_CASE_REVIEW_REQUIRED: ['حالة تتطلب مراجعة', 'فريق المراجعة يحسم الحالة وفق سياسة الاحتفاظ.'],
};

function appendBlockers(host, items, businessId, emptyMessage) {
  if (!items?.length) {
    if (emptyMessage) host.append(el('p', emptyMessage));
    return;
  }
  for (const item of items) {
    const [title, step, destination, label] = guidance[item.code] || [
      'مانع يحتاج مراجعة', 'أحِل مرجع الطلب ورمز المانع إلى فريق تشغيل المنصة. ' + item.code,
    ];
    const section = el('section', undefined, 'merchant-agreement-card');
    section.append(el('h4', title));
    if (Number.isSafeInteger(item.amount)) section.append(el('p', formatNumber(Math.abs(item.amount)) + ' د.ع'));
    else if (Number.isSafeInteger(item.count)) section.append(el('p', 'العدد ' + formatNumber(item.count)));
    section.append(el('p', step));
    if (destination && (destination !== 'branch' || businessId)) {
      const link = el('a', label);
      if (destination === 'branch') {
        link.href = '/pages/merchants.html?' + new URLSearchParams({ tab: 'branches', branchId: businessId });
      } else {
        const url = new URL(destination, location.origin);
        if (businessId && destination === ordersPage) url.searchParams.set('branch', businessId);
        link.href = url.pathname + url.search + url.hash;
      }
      section.append(link);
    }
    host.append(section);
  }
}

function viewClosure(row) {
  ++dialogRequest;
  const body = el('div');
  body.append(details([
    ['حالة الطلب', lifecycleStatuses[row.status]], ['آخر تحديث للطلب', recordedDate(row.updatedAt)],
  ]));
  body.append(el('h3', 'الموانع المسجّلة'));
  appendBlockers(body, row.blockers, row.businessId, row.blockers === null
    ? 'تعذّر التحقق من سجل الموانع لهذا الطلب.' : 'لا توجد موانع مسجّلة في آخر تحديث.');
  const reference = el('details');
  reference.append(el('summary', 'مرجع الطلب'), el('p', row.requestId));
  body.append(reference);
  showDetail(lifecycleTitle(row), body);
}

function transferDecision(row, result, focusDestination) {
  const form = el('form', undefined, 'merchant-agreement-card');
  const title = el('h3', 'قرار المراجعة');
  const decisionLabel = el('label', 'الإجراء');
  const action = el('select');
  action.id = 'ownership-review-action';
  decisionLabel.htmlFor = action.id;
  action.required = true;
  action.append(new Option('اختر الإجراء', ''));
  if (result.canApproveSettlement) action.append(new Option('اعتماد وجهة التسويات', 'APPROVE_SETTLEMENT'));
  if (result.canApprove) action.append(new Option('اعتماد نقل الملكية', 'APPROVE'));
  if (result.canReject) action.append(new Option('رفض طلب النقل', 'REJECT'));
  const reasonLabel = el('label', 'سبب القرار');
  const reason = el('textarea');
  reason.required = true;
  reason.minLength = 5;
  reason.maxLength = 500;
  reason.rows = 3;
  reasonLabel.append(reason);
  const help = el('p');
  const feedback = el('p');
  feedback.setAttribute('role', 'status');
  const submit = el('button', 'تأكيد القرار');
  submit.type = 'submit';
  submit.disabled = true;
  action.onchange = () => {
    submit.disabled = !action.value;
    help.textContent = action.value === 'REJECT'
      ? 'ينتهي طلب النقل ويُرفع القيد المرتبط به عن الفروع المشمولة.'
      : action.value === 'APPROVE_SETTLEMENT'
        ? 'تُعتمد وجهة التسويات للطلب، وتبقى الملكية بانتظار القرار النهائي.'
        : action.value === 'APPROVE'
          ? 'تنتقل الفروع إلى المالك الجديد ويُرفع قيد النقل ويُرسل إشعار لكل مالك. يتطلب استقبال الطلبات اتفاقية تجارية معتمدة باسم المالك الجديد.' : '';
  };
  form.append(title, decisionLabel, action, help, reasonLabel, feedback, submit);
  form.onsubmit = async event => {
    event.preventDefault();
    if (deciding || !action.value || !form.reportValidity()) return;
    if (reason.value.trim().length < 5) {
      feedback.textContent = errors.INVALID_TRANSFER_REVIEW;
      reason.focus();
      return;
    }
    deciding = true;
    action.disabled = reason.disabled = submit.disabled = $('merchant-close').disabled = true;
    focusDestination.disabled = true;
    try {
      const body = {
        decision: action.value, requestId: row.requestId, organizationId: row.organizationId,
        baseVersion: result.baseVersion, reason: reason.value.trim(),
        ...(action.value === 'APPROVE_SETTLEMENT' ? result.settlementEvidence : {}),
      };
      const saved = await request('/lifecycle/decision', { body });
      if (saved.status === 'REJECTED') {
        dialog.close();
        await load(false, 'سُجّل رفض طلب النقل ورُفع قيده عن الفروع المشمولة.');
      } else if (saved.status === 'COMPLETED') {
        await load(false, 'تم نقل الملكية ورفع قيد الطلبات المرتبط بالنقل.');
        await viewTransfer(row);
      } else {
        await viewTransfer(row, 'اعتمدت الإدارة وجهة التسويات.');
      }
    } catch (error) {
      feedback.textContent = error.message;
    } finally {
      deciding = false;
      action.disabled = reason.disabled = submit.disabled = $('merchant-close').disabled = focusDestination.disabled = false;
    }
  };
  return { form, focus: value => { action.value = value; action.onchange(); reason.focus(); } };
}

async function viewTransfer(row, confirmation) {
  const pending = ++dialogRequest;
  const title = lifecycleTitle(row);
  showDetail(title, el('p', 'جارٍ قراءة الطلب وفحص البيانات المتاحة…'));
  try {
    const result = await request('/lifecycle', { query: { requestId: row.requestId, organizationId: row.organizationId } });
    if (pending !== dialogRequest || !dialog.open) return;
    const current = result.request;
    const body = el('div');
    body.append(details([
      ['حالة الطلب', lifecycleStatuses[current.status]], ['إصدار الاتفاقية المقبولة', current.agreementVersion],
      ['تاريخ اكتمال النقل', recordedDate(current.completedAt)], ['تاريخ انتهاء الدعوة', current.completedAt ? null : recordedDate(current.expiresAt)], ['وقت فحص الموانع', recordedDate(result.checkedAt)],
      ['هاتف التسويات المؤكّد', result.maskedPhone],
      ['وجهة التسويات', result.settlement === 'APPROVED' ? 'معتمدة' : null],
    ]));
    if (confirmation) {
      const status = el('p', confirmation);
      status.setAttribute('role', 'status');
      body.append(status);
    }
    if (current.status === 'AWAITING_RECIPIENT') body.append(el('p', 'يقبل المالك الجديد الدعوة من تطبيق المطعم، ثم تبدأ مراجعة الإدارة.'));
    if (current.status === 'AWAITING_REVIEW' && !result.canCheck) body.append(el('p', 'يتولى المراجع المالي المخوّل فحص الموانع.'));
    const resolution = el('div');
    appendBlockers(resolution, result.blockers);
    body.append(resolution, el('h3', 'الفروع المشمولة'));
    if (result.checkError) body.append(el('p', errors[result.checkError]));
    for (const branch of result.branches) {
      const section = el('section');
      section.append(el('h4', branch.name || 'فرع تعذّر عرض اسمه'));
      if (result.checkedAt) appendBlockers(section, branch.blockers, branch.businessId,
        'لم يرصد الفحص موانع في بيانات هذا الفرع.');
      if (current.status === 'COMPLETED' && branch.businessId) {
        const next = el('a', 'فتح ملف الفرع لمراجعة الاتفاقية التجارية');
        next.href = '/pages/merchants.html?tab=branches&branchId=' + encodeURIComponent(branch.businessId);
        section.append(next);
      }
      body.append(section);
    }
    if (result.checkedAt || result.checkError) body.append(button('إعادة فحص الموانع', () => {
      if (!deciding) viewTransfer(row);
    }));
    if (current.status === 'COMPLETED') body.append(el('p', 'راجع الاتفاقية التجارية مع المالك الجديد لتفعيل الطلبات وفق الشروط المعتمدة.'));
    if (result.canApproveSettlement || result.canApprove || result.canReject) {
      const action = result.canApprove ? 'APPROVE' : 'APPROVE_SETTLEMENT';
      const go = button(result.canApprove ? 'انتقل إلى اعتماد نقل الملكية' : 'انتقل إلى اعتماد وجهة التسويات',
        () => controls.focus(action));
      const controls = transferDecision(row, result, go);
      if (result.canApproveSettlement || result.canApprove) resolution.append(go);
      body.append(controls.form);
    }
    showDetail(title, body);
  } catch (error) {
    if (pending !== dialogRequest || !dialog.open) return;
    const body = el('div');
    body.append(el('p', lifecycleStatuses[row.status]), el('p', error.message),
      button('إعادة المحاولة', () => viewTransfer(row)));
    showDetail(title, body);
  }
}

$('lifecycle-kind').onchange = event => {
  data.lifecycle = { items: [], kind: event.target.value };
  $('lifecycle-list').replaceChildren();
  $('lifecycle-more').hidden = true;
  load();
};

const changeType = row => row.kind === 'NAME' ? 'تعديل الاسم' : 'تعديل الموقع';

function viewChange(row) {
  selectedChange = row;
  const proposed = row.proposed;
  const fields = [
    ['الفرع', row.businessName],
    ['البيانات المعتمدة', row.previous],
    ['البيانات المقترحة', row.kind === 'NAME' ? proposed.businessName : proposed.address],
    ['سبب طلب التعديل', row.reason],
  ];
  if (row.kind === 'LOCATION') {
    fields.push(['المنطقة المقترحة', row.regionNames.join('، ')],
      ['إحداثيات الموقع المقترح', `${proposed.latitude}, ${proposed.longitude}`]);
  }
  showDetail(changeType(row), details(fields));
  $('merchant-change-decision').reset();
  $('merchant-change-decision').hidden = !row.canReview;
  notify('merchant-change-notice', '');
}

$('merchant-change-decision').onsubmit = async event => {
  event.preventDefault();
  if (deciding || !selectedChange) return;
  deciding = true;
  $('merchant-change-submit').disabled = true;
  $('merchant-close').disabled = true;
  notify('merchant-change-notice', 'جارٍ تسجيل القرار…');
  try {
    const decision = $('merchant-change-action').value;
    await request('/changes', {body: {requestId: selectedChange.requestId, baseVersion: selectedChange.version,
      decision, reason: $('merchant-change-reason').value.trim()}});
    dialog.close();
    data.branches.loaded = false;
    await load(false, decision === 'APPROVE' ? 'اعتُمد التعديل وحُدّثت بيانات الفرع.' : 'سُجّل رفض الطلب.');
  } catch (error) {
    notify('merchant-change-notice', error.message, true);
  } finally {
    deciding = false;
    $('merchant-change-submit').disabled = false;
    $('merchant-close').disabled = false;
  }
};

const controls = {
  PAUSE_ORDERS: {
    label: 'منع الطلبات الجديدة',
    description: 'يتوقف استقبال طلبات جديدة في هذا الفرع. تستمر متابعة الطلبات القائمة.',
  },
  RESUME_ORDERS: {
    label: 'رفع منع الطلبات',
    description: 'يمكن للمطعم تشغيل استقبال الطلبات من التطبيق بعد زوال قيود الفرع.',
  },
  SUSPEND: {
    label: 'تعليق الفرع',
    description: 'يتوقف ظهور الفرع للزبائن واستقبال الطلبات الجديدة.',
  },
  UNSUSPEND: {
    label: 'رفع تعليق الفرع',
    description: 'يُستعاد ظهور الفرع إذا كان جاهزًا. يشغّل المطعم الاستقبال من التطبيق بعد زوال القيود.',
  },
};

function branchControl(row, branch, confirmation) {
  const state = branch.control;
  const form = el('form', undefined, 'staff-policy-card');
  const notice = el('p', confirmation || '');
  notice.setAttribute('role', 'status');
  form.append(el('h3', 'التحكم التشغيلي'), notice);
  if (state.reason) form.append(details([
    ['سبب آخر إجراء', state.reason], ['تاريخ الإجراء', date(state.changedAt)],
  ]));
  if (branch.platformSuspended && branch.ordersBlocked) {
    form.append(el('p', 'منع الطلبات الجديدة قائم أيضًا على هذا الفرع.'));
  }
  if (!state.actions.length) {
    form.append(el('p', 'التحكم غير متاح في حالة الفرع الحالية.'));
    return form;
  }

  const actionLabel = el('label', 'إجراء المنصة');
  const action = el('select');
  action.required = true;
  const placeholder = el('option', 'اختر الإجراء');
  placeholder.value = '';
  action.append(placeholder);
  for (const value of state.actions) {
    if (!Object.hasOwn(controls, value)) continue;
    const item = el('option', controls[value].label);
    item.value = value;
    action.append(item);
  }
  actionLabel.append(action);
  const help = el('p');
  help.id = 'merchant-control-help';
  action.setAttribute('aria-describedby', help.id);
  action.onchange = () => { help.textContent = controls[action.value]?.description || ''; };

  const reasonLabel = el('label', 'سبب الإجراء');
  const reason = el('textarea');
  reason.required = true;
  reason.minLength = 5;
  reason.maxLength = 1000;
  reason.rows = 3;
  reasonLabel.append(reason);
  const submit = el('button', 'تأكيد الإجراء');
  submit.type = 'submit';
  form.append(actionLabel, help, reasonLabel, submit);

  form.onsubmit = async event => {
    event.preventDefault();
    if (deciding) return;
    let reloadRequired = false;
    deciding = true;
    submit.disabled = true;
    $('merchant-close').disabled = true;
    notice.textContent = 'جارٍ تسجيل الإجراء…';
    try {
      const result = await request('/control', {body: {businessId: row.businessId,
        action: action.value, reason: reason.value.trim(), baseRevision: state.revision}});
      if (result.saved !== true) throw Error('تعذّر التحقق من نتيجة الإجراء. حدّث ملف الفرع.');
      await Promise.all([viewBranch(row, 'تم تسجيل الإجراء.'), load()]);
    } catch (error) {
      notice.textContent = error.message;
      if (error.code === 'VERSION_OR_STATE_CONFLICT' || error.code === 'BRANCH_LIFECYCLE_LOCKED') {
        reloadRequired = true;
        notice.after(button('تحديث حالة الفرع', () => viewBranch(row)));
      }
    } finally {
      deciding = false;
      $('merchant-close').disabled = false;
      submit.disabled = reloadRequired;
    }
  };
  return form;
}

async function viewBranch(row, confirmation) {
  const pending = ++dialogRequest;
  showDetail(row.name, el('p', 'جارٍ تحميل ملف الفرع…'));
  try {
    const b = await request('/branch', { query: { businessId: row.businessId } });
    if (pending !== dialogRequest || !dialog.open) return;
    showDetail(b.name, details([
      ['نوع النشاط', typeLabels[b.type] || b.type],
      ['منطقة الخدمة', b.region],
      ['العنوان', b.address],
      ['استقبال الطلبات', branchStatus(b)[0]],
      ['القائمة', b.menuPublished ? 'نسخة منشورة' : 'بانتظار نشر القائمة'],
      ['الاتفاقية التجارية', b.agreement && labels[b.agreement.status]],
      ['إصدار الاتفاقية', b.agreement?.version ? String(b.agreement.version) : null],
      ['بداية السريان', date(b.agreement?.effectiveFrom)],
      ['نهاية السريان', date(b.agreement?.effectiveTo)],
    ]));
    if (b.control) $('merchant-summary').append(branchControl(row, b, confirmation));
    if (b.agreement) {
      const panel = el('div', undefined, 'merchant-commercial');
      const actions = el('div', undefined, 'merchant-header');
      const content = el('div');
      const funding = el('a', 'التمويل المشترك للعروض', 'button merchant-secondary');
      funding.href = '/pages/shared-funding.html?' + new URLSearchParams({businessId:b.businessId});
      actions.append(
        button('الاتفاقيات التجارية', () => window.MerchantCommercial.render(content, b)),
        funding,
      );
      panel.append(actions, content);
      $('merchant-summary').append(panel);
    }
  } catch (error) {
    if (pending === dialogRequest && dialog.open) showDetail(row.name, el('p', error.message));
  }
}

function hoursSection(hours) {
  if (!hours?.some(day => !day.closed)) return el('p', 'لم تُسجّل ساعات عمل.');
  const section = el('details');
  const list = el('ul');
  for (const day of hours) {
    const periods = day.periods?.map(p => p.open + '–' + p.close).join('، ');
    list.append(el('li', (weekdays[day.day] || '') + ' · ' + (day.closed ? 'مغلق' : periods)));
  }
  section.append(el('summary', 'ساعات العمل'), list);
  return section;
}

function viewRequest(row) {
  ++dialogRequest;
  selectedRequest = row;
  showDetail(row.name, details([
    ['نوع النشاط', typeLabels[row.type] || row.type],
    ['منطقة الخدمة', row.region],
    ['العنوان', row.address],
    ['تاريخ الإرسال', date(row.submittedAt)],
    ['نسخة اتفاقية الشراكة المقبولة', row.termsVersion],
  ]));
  $('merchant-summary').append(hoursSection(row.openingHours));

  const documents = $('merchant-documents');
  if (row.canReadDocuments && row.documents.length) {
    documents.append(el('h3', 'مستندات الطلب'));
    for (const item of row.documents) {
      const line = el('div', undefined, 'merchant-doc-row');
      const show = button(item.kind === 'registration' ? 'عرض شهادة التسجيل' : 'عرض صورة الفرع', async () => {
        show.disabled = true;
        status.textContent = 'جارٍ تجهيز الرابط…';
        try {
          const result = await request('/application-asset', { query: { queueKey: row.queueKey, assetId: item.id } });
          const url = new URL(result.url);
          const host = 'wizz-production-merchant-onboarding-746727375268.s3.us-east-1.amazonaws.com';
          if (url.protocol !== 'https:' || url.hostname !== host) throw Error(errors.ASSET_UNAVAILABLE);
          const link = el('a', 'فتح المستند خلال دقيقة', 'button');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          status.replaceChildren(link);
        } catch (error) {
          status.textContent = error.message;
        } finally {
          show.disabled = false;
        }
      });
      const status = el('span');
      status.setAttribute('role', 'status');
      line.append(show, status);
      documents.append(line);
    }
  }
  const form = $('merchant-decision');
  form.reset();
  $('merchant-decision-help').textContent = '';
  notify('merchant-dialog-notice', '');
  form.hidden = !row.canReview;
}

const hints = {
  APPROVE: 'سيُضاف الفرع لحساب المالك وتبقى الطلبات متوقفة حتى تجهيز الفرع.',
  NEEDS_INFORMATION: 'يستطيع المالك تعديل الطلب وإرساله للمراجعة مرة أخرى.',
  REJECT: 'يظهر سبب الرفض للمالك في التطبيق.',
};
$('merchant-action').onchange = () => { $('merchant-decision-help').textContent = hints[$('merchant-action').value] || ''; };
$('merchant-decision').onsubmit = async event => {
  event.preventDefault();
  if (deciding || !selectedRequest) return;
  deciding = true;
  $('merchant-submit').disabled = true;
  $('merchant-close').disabled = true;
  notify('merchant-dialog-notice', 'جارٍ تسجيل القرار…');
  try {
    const decision = $('merchant-action').value;
    await request('/applications/review', { body: { queueKey: selectedRequest.queueKey, baseVersion: selectedRequest.version,
      decision, reason: $('merchant-reason').value.trim() } });
    dialog.close();
    data.branches.loaded = false;
    const messages = { APPROVE: 'اعتُمد الفرع وأضيف إلى الفروع المسجّلة.', NEEDS_INFORMATION: 'أُعيد الطلب إلى المالك للاستكمال.', REJECT: 'سُجّل رفض الطلب.' };
    await load(false, messages[decision]);
  } catch (error) {
    notify('merchant-dialog-notice', error.message, true);
  } finally {
    deciding = false;
    $('merchant-submit').disabled = false;
    $('merchant-close').disabled = false;
  }
};
$('merchant-refresh').onclick = () => load();
$('merchant-close').onclick = () => dialog.close();
dialog.addEventListener('cancel', event => { if (deciding) event.preventDefault(); });
const initialQuery = new URLSearchParams(location.search);
const initialTab = initialQuery.get('tab');
switchTab(tabs.includes(initialTab) ? initialTab : 'applications');
const linkedBranch = initialQuery.get('branchId');
if (initialTab === 'branches' && /^[a-z0-9_-]{1,128}$/i.test(linkedBranch || '')) {
  viewBranch({ businessId: linkedBranch, name: 'ملف الفرع' });
}
