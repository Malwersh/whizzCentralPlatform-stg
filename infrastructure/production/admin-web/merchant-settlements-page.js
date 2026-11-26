'use strict';

const cashboxes = document.getElementById('company-cashboxes');
const settlementsPath = '/staff/settlement-schedules';
async function cashboxRequest(body, query) {
  await window.Auth.ensureSession();
  const url = new URL(settlementsPath, location.origin);
  if (query) url.search = new URLSearchParams(query).toString();
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    cache: 'no-store',
    signal: AbortSignal.timeout(25000),
    headers: {
      Authorization: 'Bearer ' + window.Auth.getToken('accessToken'),
      'Content-Type': 'application/json',
    },
    ...(body ? {body: JSON.stringify(body)} : {}),
  });
  const result = await response.json();
  if (!response.ok) {
    throw Error(window.CashboxErrorMessages?.[result.error] ||
      'تعذر إكمال إجراء الصندوق. راجع الصلاحيات وحالة الحركة.');
  }
  return result;
}
const cashbook = window.MerchantCashboxes({
  host: cashboxes, branchId: 'COMPANY_CASHBOOK', api: cashboxRequest, standalone: true,
});

const account = document.getElementById('completed-order-settlements');
const schedules = document.getElementById('merchant-settlement-schedules');
const sections = [account, cashboxes, schedules];
const links = document.querySelectorAll('.merchant-finance-nav a');
let cashbookOpened = false;
function openSection() {
  const active = sections.find(section => '#' + section.id === location.hash) ?? account;
  for (const section of sections) section.hidden = section !== active;
  for (const link of links) {
    if (link.hash === '#' + active.id) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  if (active !== cashboxes) active.open = true;
  else if (!cashbookOpened) {
    cashbookOpened = true;
    cashbook.load();
  }
}
openSection();
window.addEventListener('hashchange', openSection);
