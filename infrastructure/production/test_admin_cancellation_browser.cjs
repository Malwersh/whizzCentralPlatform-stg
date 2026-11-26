'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const pagePath = '/pages/order-cancellation.html';
const types = {'.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html'};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  res.end(fs.readFileSync(file));
});

const item = {
  caseId: 'OEX:test', orderId: 'order-test', orderNumber: 'ORD1797982600000',
  caseKey: 'CUSTOMER_CANCELLATION', branchName: 'مطعم الاختبار', state: 'REQUESTED',
  orderStatus: 'preparing', reason: 'طلب الزبون إلغاء الطلب', version: 2, notes: [],
  createdAt: '2026-11-24T18:00:00Z', actions: ['REQUEST_EVIDENCE','DECLINE_CANCELLATION','ADD_NOTE'],
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless: true, channel: 'chrome'});
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({viewport: {width, height: 840}});
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      let saved = null;
      let showCompensation = false;
      let financialDecision = null;
      const financialActions = [];
      const financial = {
        orderId: item.orderId, orderNumber: item.orderNumber, caseId: item.caseId,
        caseKey: item.caseKey, branchId: 'branch-test', version: 3, canApprove: true,
        driverFareCapIqd: 1000, merchantCapIqd: 2000, holdReleasedIqd: 0,
        driverStage: 'ARRIVED', cancellationReason: 'إلغاء قبل استلام الطلب',
      };
      await page.route('**/assets/js/auth-utils.js', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'window.Auth={ensureSession:async()=>{},getToken:()=>"test-session",clearTokens:()=>{}};',
      }));
      await page.route('**/staff/order-cancellation*', async r => {
        const req = r.request();
        assert.equal(req.headers().authorization, 'Bearer test-session');
        const params = new URL(req.url()).searchParams;
        if (params.get('view') === 'compensation') {
          if (req.method() === 'GET') {
            assert.equal(params.get('orderId'), item.orderId);
            assert.equal(params.get('caseKey'), item.caseKey);
            return r.fulfill({json: {success: true, item: financial}});
          }
          const action = req.postDataJSON();
          financialActions.push(action);
          financial.version++;
          if (action.action === 'APPROVE') {
            financialDecision = action;
            financial.decision = {...action, decisionId: action.idempotencyKey, platformFundingIqd: 500};
          } else if (action.action === 'EXECUTE') {
            assert.equal(action.decisionId, financialDecision.idempotencyKey);
            financial.posted = {operationId: 'op-test'};
            financial.merchantPayment = {status: 'LOCKED_PENDING_SETTLEMENT'};
          }
          return r.fulfill({json: {success: true, status: action.action === 'APPROVE' ? 'APPROVED' : 'EXECUTED'}});
        }
        if (req.method() === 'POST') {
          saved = req.postDataJSON();
          return r.fulfill({json: {success: true, caseId: item.caseId, orderId: item.orderId, action: saved.action}});
        }
        const lookUp = params.get('order');
        if (showCompensation) return r.fulfill({json: {items: [{
          ...item, state: 'CANCELLED', orderStatus: 'cancelled', actions: [],
          canViewCompensation: true, settlementPending: true,
        }]}});
        const items = !saved ? [item] : lookUp === item.orderNumber
          ? [{...item, state: 'DECLINED', decision: {reason: saved.reason}, actions: []}] : [];
        return r.fulfill({json: {items}});
      });
      await page.goto('http://127.0.0.1:' + server.address().port + pagePath);
      const summary = page.locator('.cancellation-case summary');
      await summary.click();
      await page.getByText('بانتظار إفادة المطعم', {exact: false}).waitFor();
      assert.equal(await page.locator('option[value="CANCEL_BEFORE_PICKUP"]').count(), 0);
      assert.equal(await page.locator('.platform-sidebar a[aria-current="page"]').textContent(), 'طلبات الإلغاء');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByLabel('الإجراء').selectOption('DECLINE_CANCELLATION');
      await page.getByLabel('سبب القرار أو الملاحظة').fill('استمرار الطلب بناءً على طلب الزبون');
      await page.getByRole('button', {name: 'تسجيل الإجراء'}).click();
      await page.getByText('تم تسجيل الإجراء. لا توجد طلبات إلغاء مفتوحة.').waitFor();
      assert.equal(saved.expectedVersion, 2);
      assert.equal(saved.action, 'DECLINE_CANCELLATION');
      assert.match(saved.idempotencyKey, /^[a-f0-9-]{36}$/i);
      await page.getByLabel('البحث برقم الطلب').fill(item.orderNumber);
      await page.getByRole('button', {name: 'بحث', exact: true}).click();
      await summary.click();
      await page.getByText('استمرار الطلب بناءً على طلب الزبون', {exact: true}).waitFor();

      showCompensation = true;
      await page.getByRole('button', {name:'تحديث الطلبات'}).click();
      await summary.click();
      await page.getByRole('link', {name:'مراجعة تعويض الإلغاء'}).click();
      await page.locator('#assessment').waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.locator('#requester').selectOption('CUSTOMER');
      await page.locator('#channel').selectOption('SUPPORT');
      await page.locator('#food-state').selectOption('UNUSABLE');
      for (const [field, value] of Object.entries({
        reference:'تذكرة الدعم ١٢٣٤٥', 'driver-amount':'0', 'food-loss':'500',
        'merchant-amount':'500', 'food-reference':'الأصناف تلفت وفق الإفادة',
        agreement:'الاتفاقية المعتمدة', reason:'تعويض عن الخسارة الموثقة',
      })) await page.locator('#' + field).fill(value);
      await page.getByRole('button', {name:'مراجعة المبالغ قبل الاعتماد'}).click();
      await page.locator('#review').waitFor();
      assert.equal(financialActions.length, 0);
      await page.getByRole('button', {name:'اعتماد القرار دون صرف'}).click();
      await page.getByRole('button', {name:'تنفيذ التعويض المعتمد'}).click();
      assert.deepEqual(financialActions.map(action => action.action), ['APPROVE']);
      await page.getByRole('button', {name:'تأكيد تنفيذ القيد'}).click();
      const finance = page.getByRole('link', {name:'فتح الإدارة المالية لمتابعة صرف المطعم'});
      await finance.waitFor();
      assert.equal(await finance.getAttribute('href'), '/pages/merchant-settlements.html?branchId=branch-test#completed-order-settlements');
      assert.equal(await page.locator('#close-case').isVisible(), false);
      assert.deepEqual(financialActions.map(action => action.action), ['APPROVE', 'EXECUTE']);
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Cancellation queue, decisions and compensation passed on mobile and desktop.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
