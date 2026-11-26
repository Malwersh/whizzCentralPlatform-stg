'use strict';

const path = '/staff/order-cancellation';
const get = id => document.getElementById('cancellation-' + id);
const make = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const states = {
  REQUESTED: 'بانتظار المراجعة', CANCELLED: 'تم الإلغاء', DECLINED: 'رُفض الإلغاء',
  SUPERSEDED: 'أُغلق بعد إلغاء المطعم',
};
const orderStates = {
  pending: 'قيد الانتظار', confirmed: 'مؤكد', accepted: 'مقبول', preparing: 'قيد التحضير',
  ready: 'جاهز', ready_for_pickup: 'جاهز للاستلام', assigned: 'أُسند إلى سائق',
  heading_to_store: 'السائق في الطريق إلى المطعم', arrived_at_store: 'السائق عند المطعم',
  picked_up: 'استلمه السائق', out_for_delivery: 'قيد التوصيل',
  heading_to_customer: 'السائق في الطريق إلى الزبون', arrived_at_customer: 'السائق عند الزبون',
  delivered: 'تم التوصيل', completed: 'مكتمل', returned: 'مرتجع', cancelled: 'ملغى', canceled: 'ملغى',
};
const preparation = {NOT_STARTED: 'لم يبدأ التحضير', STARTED: 'بدأ التحضير', READY: 'جاهز'};
const actions = {
  REQUEST_EVIDENCE: 'تسجيل طلب إفادة', CANCEL_BEFORE_PICKUP: 'اعتماد الإلغاء قبل الاستلام',
  DECLINE_CANCELLATION: 'رفض الإلغاء وإبقاء الطلب نشطًا', ADD_NOTE: 'إضافة ملاحظة داخلية',
};
const errors = {
  EXCEPTION_PERMISSION_REQUIRED: 'حسابك لا يملك صلاحية تنفيذ هذا الإجراء.',
  EXCEPTION_EMPLOYEE_UNAVAILABLE: 'حسابك غير مخوّل بمراجعة طلبات الإلغاء على مستوى المنصة.',
  EXCEPTION_CASE_CONFLICT: 'تغيرت حالة الطلب. حدّث القائمة وراجع التفاصيل قبل تسجيل القرار.',
  CANCELLATION_RETAINED_PROOF_REQUIRED: 'اعتماد الإلغاء يتطلب إفادة المطعم بأن الأصناف ما زالت لديه.',
  CANCELLATION_AFTER_PICKUP_OR_TERMINAL: 'تغيرت حالة الطلب ولم يعد الإلغاء قبل الاستلام متاحًا.',
  EXCEPTION_CASE_ACTION_NOT_ALLOWED: 'هذا الإجراء غير متاح في الحالة الحالية. حدّث الطلب.',
  INVALID_EXCEPTION_CASE_ACTION: 'تحقق من سبب القرار وحالة الطلب.',
  INVALID_EXCEPTION_SELECTOR: 'تحقق من رقم الطلب.',
  INVALID_CURSOR: 'حدّث القائمة لمتابعة تحميل الطلبات.',
  FORBIDDEN: 'حسابك لا يملك صلاحية لهذا الإجراء.',
};
const formatDate = new Intl.DateTimeFormat('ar-IQ', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Baghdad',
});
const date = value => Number.isFinite(Date.parse(value)) ? formatDate.format(new Date(value)) : 'غير مسجل';
let query = new URLSearchParams(location.search).get('order') ?? '';
let cursor = null;
let busy = false;

async function request(params, body) {
  await window.Auth.ensureSession();
  const response = await fetch(path + (params?.size ? '?' + params : ''), {
    method: body ? 'POST' : 'GET',
    headers: {'Authorization': 'Bearer ' + window.Auth.getToken('accessToken'),
      ...(body ? {'Content-Type': 'application/json'} : {})},
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  if (response.status === 401) {
    window.Auth.clearTokens();
    location.replace('/index.html');
    throw Error('انتهت جلسة الدخول.');
  }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw Error(errors[value.error] || 'تعذر الاتصال بخدمة طلبات الإلغاء. أعد المحاولة.');
  return value;
}

function fact(list, label, value) {
  const part = make('div');
  part.append(make('dt', label), make('dd', value));
  list.append(part);
}

function decisionForm(item, card) {
  const form = make('form', null, 'review-decision');
  const actionLabel = make('label', 'الإجراء');
  const action = make('select');
  action.append(new Option('اختر إجراءً', ''));
  action.required = true;
  for (const key of item.actions) action.append(new Option(actions[key], key));
  actionLabel.append(action);
  const reasonLabel = make('label', 'سبب القرار أو الملاحظة');
  const reason = make('textarea');
  reason.rows = 3;
  reason.required = true;
  reason.minLength = 5;
  reason.maxLength = 1000;
  reasonLabel.append(reason);
  const submit = make('button', 'تسجيل الإجراء');
  submit.type = 'submit';
  const message = make('p');
  message.role = 'status';
  form.append(actionLabel, reasonLabel, submit, message);
  let retry;
  form.onsubmit = async event => {
    event.preventDefault();
    if (submit.disabled || busy) return;
    const note = reason.value.trim();
    if (note.length < 5) {
      message.textContent = 'اكتب سببًا من خمسة أحرف على الأقل.';
      return;
    }
    if (!retry || retry.action !== action.value || retry.reason !== note) {
      retry = {action: action.value, reason: note, idempotencyKey: crypto.randomUUID()};
    }
    submit.disabled = action.disabled = reason.disabled = true;
    message.textContent = 'جارٍ تسجيل الإجراء…';
    try {
      const receipt = await request(null, {
        ...retry, orderId: item.orderId, caseKey: item.caseKey, caseId: item.caseId, expectedVersion: item.version,
      });
      if (receipt.success !== true || receipt.caseId !== item.caseId ||
          receipt.orderId !== item.orderId || receipt.action !== retry.action) {
        throw Error('تعذر تأكيد الإجراء. حدّث حالة الطلب للتحقق.');
      }
      await load(false, 'تم تسجيل الإجراء.');
    } catch (error) {
      message.textContent = error.name === 'TimeoutError'
        ? 'تعذر تأكيد النتيجة. حدّث الطلب للتحقق أو أعد إرسال الإجراء نفسه.'
        : error.message;
      submit.disabled = action.disabled = reason.disabled = false;
    }
  };
  card.append(form);
}

function render(item) {
  const details = make('details', null, 'cancellation-case');
  const head = make('summary');
  const orderNumber = make('bdi', item.orderNumber ?? '');
  head.append(make('strong', item.branchName), orderNumber, make('span',
    item.settlementPending ? 'بانتظار المراجعة المالية' : states[item.state] || 'تحتاج مراجعة', 'status'));
  const body = make('div');
  const facts = make('dl', null, 'cancellation-facts');
  fact(facts, 'حالة الطلب', orderStates[item.orderStatus] ?? 'راجع تفاصيل الطلب');
  fact(facts, 'صاحب طلب الإلغاء', item.caseKey === 'CUSTOMER_CANCELLATION' ? 'الزبون' : 'المطعم');
  fact(facts, 'تاريخ الطلب', date(item.createdAt));
  body.append(facts, make('h3', 'سبب الإلغاء'), make('p', item.reason || 'غير مسجل'));
  if (item.retention) {
    body.append(make('h3', 'إفادة المطعم'), make('p', preparation[item.retention.preparationState]),
      make('p', item.retention.note));
  }
  if (item.state === 'REQUESTED' && (!item.canConfirmRetainedGoods || item.pickupRecorded)) {
    const message = item.pickupRecorded ? 'سُجّل استلام الطلب أو إغلاقه.'
      : 'بانتظار إفادة المطعم بأن الأصناف ما زالت لديه. يمكن تسجيل طلب إفادة من هنا.';
    body.append(make('p', message, 'cancellation-reminder'));
  }
  if (item.evidenceRequest) body.append(make('h3', 'الإفادة المطلوبة'), make('p', item.evidenceRequest));
  if (item.decision?.reason) body.append(make('h3', 'سبب القرار'), make('p', item.decision.reason));
  if (item.notes.length) {
    const notes = make('ul');
    for (const note of item.notes) notes.append(make('li', note.text));
    body.append(make('h3', 'الملاحظات الداخلية'), notes);
  }
  if (item.actions.length) decisionForm(item, body);
  if (item.canViewCompensation) {
    const link = make('a', 'مراجعة تعويض الإلغاء');
    const params = new URLSearchParams({orderId: item.orderId, caseKey: item.caseKey});
    link.href = '/pages/cancellation-compensation.html?' + params;
    body.append(link);
  }
  details.append(head, body);
  return details;
}

async function load(append = false, notice = '') {
  if (busy) return;
  busy = true;
  get('refresh').disabled = get('more').disabled = true;
  const params = new URLSearchParams();
  if (query) params.set('order', query);
  if (append && cursor) params.set('cursor', cursor);
  get('message').textContent = 'جارٍ تحميل الطلبات…';
  try {
    const result = await request(params);
    const queue = get('queue');
    if (!append) queue.replaceChildren();
    for (const item of result.items) queue.append(render(item));
    cursor = result.nextCursor ?? null;
    get('more').hidden = !cursor;
    get('message').textContent = [notice, queue.children.length || cursor ? '' :
      query ? 'لم نجد طلب إلغاء بهذا الرقم.' : 'لا توجد طلبات إلغاء مفتوحة.'].filter(Boolean).join(' ');
  } catch (error) {
    get('message').textContent = error.message;
  } finally {
    busy = false;
    get('refresh').disabled = get('more').disabled = false;
  }
}

get('more').onclick = () => load(true);
get('refresh').onclick = () => load();
get('search').onsubmit = event => {
  event.preventDefault();
  if (busy) return;
  query = get('order').value.trim();
  get('heading').textContent = query ? 'نتائج البحث' : 'الطلبات المفتوحة';
  get('reset').hidden = !query;
  load();
};
get('reset').onclick = () => {
  get('order').value = '';
  get('search').requestSubmit();
};
if (query) {
  get('order').value = query;
  get('search').requestSubmit();
} else load();
