'use strict';

const byId = id => document.getElementById(id);
const queueSources = {
  applications: ['/staff/merchants/applications', 'nextCursor'],
  cancellations: ['/staff/order-cancellation', 'nextCursor'],
  complaints: ['/complaints-api/staff?state=open', 'cursor'],
  dispatch: ['/staff/order-monitoring/followup', 'nextCursor'],
};
const queueCards = [...document.querySelectorAll('[data-queue]')];
const formatCount = new Intl.NumberFormat('ar-IQ');
const formatRevenue = new Intl.NumberFormat('ar-IQ', {
  style: 'currency', currency: 'IQD', maximumFractionDigits: 3, minimumFractionDigits: 0,
});
const formatTime = new Intl.DateTimeFormat('ar-IQ', {
  timeZone: 'Asia/Baghdad', hour: 'numeric', minute: 'numeric',
});
const maxQueuePages = 3;
const greetingRoleLabels = {
  bootstrap_admin: 'مدير المنصة',
  platform_manager: 'مدير المنصة',
  commercial_viewer: 'مراجع تجاري',
  commercial_editor: 'محرر الشؤون التجارية',
  commercial_approver: 'مسؤول الاعتماد التجاري',
};

function staffGet(path, token, signal) {
  return fetch(path, {
    headers: { Authorization: 'Bearer ' + token },
    signal,
    cache: 'no-store',
  });
}

async function readQueue(card, token, signal) {
  const value = card.querySelector('.dashboard-queue-value');
  value.textContent = 'جارٍ التحميل…';
  const [path, cursorKey] = queueSources[card.dataset.queue];
  let count = 0;
  let cursor;
  try {
    for (let page = 0; page < maxQueuePages; page++) {
      const url = new URL(path, location.origin);
      if (cursor) url.searchParams.set('cursor', cursor);
      const response = await staffGet(url, token, signal);
      if (!response.ok) throw Error('Queue unavailable');
      const result = await response.json();
      if (!Array.isArray(result.items)) throw Error('Invalid queue');
      count += result.items.length;
      cursor = result[cursorKey];
      if (!cursor) break;
    }
    if (window.Auth.getToken('accessToken') !== token) throw Error('Session changed');
    const formatted = formatCount.format(count);
    value.textContent = cursor
      ? (count ? 'على الأقل ' + formatted : 'عرض القائمة الكاملة')
      : formatted;
  } catch {
    value.textContent = 'تعذّر تحميل العدد';
  }
}

async function refreshQueues() {
  const refresh = byId('refresh-queues');
  const cards = queueCards.filter(card => !card.hidden);
  if (!cards.length || refresh.disabled) return;
  refresh.disabled = true;
  const controller = new AbortController();
  let timer;
  try {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    timer = setTimeout(() => controller.abort(), 15000);
    await Promise.all(cards.map(card => readQueue(card, token, controller.signal)));
  } catch {
    for (const card of cards) {
      card.querySelector('.dashboard-queue-value').textContent = 'تعذّر تحميل العدد';
    }
  } finally {
    clearTimeout(timer);
    refresh.disabled = false;
  }
}

async function refreshActivity() {
  const refresh = byId('refresh-activity');
  if (byId('dashboard-activity').hidden || refresh.disabled) return;
  const fields = [...document.querySelectorAll('.dashboard-activity-grid > div:not([hidden]) [data-metric]')];
  const status = byId('activity-status');
  refresh.disabled = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  for (const field of fields) {
    field.textContent = 'جارٍ التحميل…';
    delete field.dataset.count;
  }
  status.textContent = '';
  try {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    const response = await staffGet('/staff/dashboard/activity', token, controller.signal);
    if (!response.ok) throw Error('Activity unavailable');
    const {metrics, measuredAt} = await response.json();
    if (window.Auth.getToken('accessToken') !== token) throw Error('Session changed');
    for (const field of fields) {
      const metric = metrics?.[field.dataset.metric];
      const revenue = field.dataset.metric === 'revenue';
      if (!Number.isSafeInteger(metric?.value) || (!revenue && metric.value < 0) || typeof metric.complete !== 'boolean') {
        field.textContent = revenue ? 'الإيراد غير متاح' : 'العدد غير متاح';
      } else if (metric.complete) {
        field.textContent = revenue ? formatRevenue.format(metric.value / 1000) : formatCount.format(metric.value);
        field.dataset.count = 'exact';
      } else if (revenue) {
        field.textContent = 'إجمالي غير مكتمل';
      } else {
        field.textContent = metric.value ? 'على الأقل ' + formatCount.format(metric.value) : 'العدد غير مكتمل';
      }
    }
    const time = Date.parse(measuredAt);
    if (Number.isFinite(time)) status.textContent = 'آخر قياس ' + formatTime.format(time) + ' بتوقيت بغداد';
  } catch {
    for (const field of fields) {
      field.textContent = field.dataset.metric === 'revenue' ? 'الإيراد غير متاح' : 'العدد غير متاح';
    }
    status.textContent = 'تعذّر تحميل المؤشرات. أعد المحاولة.';
  } finally {
    clearTimeout(timer);
    refresh.disabled = false;
  }
}

async function load() {
  const message = byId('message');
  const retry = byId('retry');
  retry.hidden = true;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    await window.Auth.ensureSession();
    const token = window.Auth.getToken('accessToken');
    const response = await staffGet('/staff/me', token, controller.signal);
    if (response.status === 401) {
      window.Auth.clearTokens();
      location.replace('/index.html');
      return;
    }
    if (response.status === 503) throw Error('خدمة إدارة الإنتاج لم تُفعّل بعد.');
    if (!response.ok) throw Error('حساب الإدارة غير مخوّل للوصول.');
    const profile = await response.json();
    if (window.Auth.getToken('accessToken') !== token) throw Error('تغيّرت جلسة الإدارة. أعد المحاولة.');
    if (profile.activationRequired) {
      location.replace('/pages/account-security.html');
      return;
    }
    const employee = profile.employee;
    byId('name').textContent = employee.displayName || employee.name || 'حساب الإدارة';
    const roles = (employee.roles || []).map(role =>
      Object.hasOwn(greetingRoleLabels, role) ? greetingRoleLabels[role] : window.WizzLocale.role(role));
    byId('role').textContent = '(' + ([...new Set(roles)].join('، ') || 'موظف') + ')';
    const permissions = new Set(profile.permissions || []);
    for (const item of document.querySelectorAll('#account [data-permission]')) {
      const hasPermission = item.dataset.permission.split(' ').some(key => permissions.has(key));
      item.hidden = !hasPermission || (item.querySelector('a').pathname === '/pages/support.html' &&
        !document.querySelector('.platform-sidebar a[href="/pages/support.html"]'));
    }
    const hasShortcuts = Boolean(byId('shortcuts').querySelector('li:not([hidden])'));
    byId('shortcuts-empty').hidden = hasShortcuts;
    byId('shortcuts-heading').hidden = !hasShortcuts;
    byId('shortcuts').hidden = !hasShortcuts;
    document.querySelector('.dashboard-queues').hidden = queueCards.every(card => card.hidden);
    byId('dashboard-activity').hidden = !permissions.has('dashboard.read') || employee.scope?.allRegions !== true;
    for (const card of document.querySelectorAll('[data-metric-permission]')) {
      card.hidden = !permissions.has(card.dataset.metricPermission);
    }
    byId('account').hidden = false;
    message.textContent = '';
    await Promise.all([refreshQueues(), refreshActivity()]);
  } catch (error) {
    message.textContent = error.code === 'SessionExpired' ? 'انتهت جلسة الدخول. سجّل الدخول مجددًا.'
      : error.name === 'AbortError' ? 'تعذّر الاتصال. أعد المحاولة.' : error.message;
    retry.hidden = false;
  } finally {
    clearTimeout(timer);
  }
}

byId('retry').onclick = load;
byId('refresh-queues').onclick = refreshQueues;
byId('refresh-activity').onclick = refreshActivity;
load();
