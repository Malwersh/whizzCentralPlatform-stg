'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const types = {'.js':'application/javascript', '.css':'text/css', '.html':'text/html'};
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, {'Content-Type': types[path.extname(file)] || 'application/octet-stream'});
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, channel:'chrome'});
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/pages/merchant-settlements.html';
    for (const width of [390, 1280]) {
      const page = await browser.newPage({viewport:{width, height:850}});
      const errors = [];
      const calls = [];
      const mutations = [];
      const operator = 'cashbox-custodian';
      const generatedAt = '2026-11-24T00:00:00Z';
      let box = null, balance = null, operations = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/assets/js/auth-utils.js', route => route.fulfill({
        contentType:'application/javascript',
        body:'window.Auth={ensureSession:async()=>{},getToken:()=>"test-session",logout:async()=>{}};',
      }));
      await page.route('**/staff/settlement-schedules**', async route => {
        const request = route.request();
        const destination = new URL(request.url());
        const view = destination.searchParams.get('view');
        calls.push({view, method: request.method(), token: request.headers()['authorization']});
        let body = {items:[], nextCursor:null};
        if (request.method() === 'POST') {
          const action = request.postDataJSON();
          mutations.push(action);
          assert.equal(action.branchId, 'COMPANY_CASHBOOK');
          assert.match(action.requestId, /^[a-f0-9-]{36}$/);
          if (action.action === 'CREATE_CASHBOX') {
            assert.equal(action.custodianEmployeeId, operator);
            assert.ok(!('amountIqd' in action));
            box = {...action, custodian:'أمين بغداد', version:1};
            body = {cashbox:box};
          } else if (action.action === 'REQUEST_CASH_OPERATION') {
            const operation = {operationId:'CFO:test-' + operations.length, request:action, version:1,
              requestedAt:generatedAt, requestedBy:operator, status:'PENDING_APPROVAL', sk:'OP#' + operations.length};
            operations.push(operation);
            body = {operation};
          } else if (action.action === 'POST_CASH_OPERATION') {
            const operation = operations.find(row => row.operationId === action.operationId);
            assert.equal(action.confirmedPhysicalOperation, true);
            assert.equal(operation.status, 'PENDING_APPROVAL');
            operation.status = 'POSTED';
            operation.journalId = 'SYNTHETIC-RECEIPT';
            balance = {balanceIqd:(balance?.balanceIqd ?? 0) + operation.request.amountIqd};
            body = {operation};
          } else assert.fail('Unexpected mutation');
        } else if (destination.pathname.endsWith('/branches')) body.items = [{businessId:'branch-a', businessName:'المطعم التجريبي'}];
        else if (view === 'cashboxes') body.items = box ? [box] : [];
        else if (view === 'cash-custodians') body.items = [{employeeId:operator, name:'أمين بغداد', canRequestFinance:true}];
        else if (view === 'cash-account') body = {cashbox:box, balance, pendingCount:null, generatedAt};
        else if (view === 'cash-operations') body.items = operations;
        else if (!view) body = {branchId:'branch-a', current:null, proposals:[], versions:[], can:{}};
        else if (view === 'merchant-account') Object.assign(body, {
          coverage:'POSTED_MERCHANT_LEDGER_MOVEMENTS', amountLabels:{}, wallet:null,
          generatedAt:'2026-11-24T00:00:00Z',
        });
        await route.fulfill({json:body});
      });
      await page.goto(url);
      const account = page.locator('#completed-order-settlements');
      const branches = account.getByRole('combobox', {name:'المتجر المطلوب كشف تسوياته'});
      await branches.locator('option', {hasText:'المطعم التجريبي'}).waitFor({state:'attached'});
      await branches.selectOption('branch-a');
      await account.getByRole('button', {name:'عرض المستحقات'}).click();
      for (const name of ['الحساب والمستحقات','الكشوف والتسويات','الصرف والمتابعة']) {
        await account.getByRole('tab', {name}).click();
        assert.equal(await account.getByRole('tab', {name}).getAttribute('aria-selected'), 'true');
      }
      await page.getByRole('link', {name:'صناديق الشركة', exact:true}).click();
      await page.getByText('لا توجد صناديق مسجّلة بعد.').waitFor();
      assert.equal(await account.isVisible(), false);
      await page.getByRole('button', {name:'إنشاء صندوق'}).click();
      const cash = page.locator('#company-cashboxes');
      await cash.getByLabel('رمز الصندوق', {exact:false}).fill('CASH-BGD-01');
      await cash.getByLabel('اسم الصندوق').fill('صندوق بغداد');
      await cash.getByLabel('موقع الصندوق').fill('بغداد');
      await cash.getByLabel('سبب تسجيل الصندوق', {exact:false}).fill('تسجيل صندوق الاختبار');
      await cash.getByLabel('أمين الصندوق', {exact:false}).selectOption(operator);
      await cash.getByRole('button', {name:'حفظ الصندوق'}).click();
      await cash.getByText('تهيئة الرصيد الافتتاحي', {exact:true}).waitFor();
      assert.equal(balance, null);
      async function requestMovement(amount, reference) {
        await cash.getByLabel('المبلغ بالدينار').fill(String(amount));
        await cash.getByLabel('مرجع الإثبات أو المحضر').fill(reference);
        await cash.getByLabel('سبب هذه الحركة').fill('إثبات حركة نقدية للاختبار');
        await cash.getByLabel('الطرف المقابل أو القائم بالجرد').fill('الشركة');
        await cash.getByRole('button', {name:'إرسال هذه الحركة للاعتماد'}).click();
        await cash.getByText('حُفظ طلب الحركة بانتظار الاعتماد.', {exact:false}).waitFor();
      }
      async function approveMovement(type) {
        await cash.locator('summary').filter({hasText: type + ' ·'}).filter({hasText:'بانتظار الاعتماد'}).click();
        const approve = cash.getByRole('button', {name:'اعتماد وتسجيل الحركة'});
        const before = mutations.length;
        await approve.click();
        await cash.getByText('راجع الإثبات وأكد العملية الفعلية قبل التسجيل.').waitFor();
        assert.equal(mutations.length, before);
        await cash.getByLabel('أؤكد مراجعة الإثبات وتنفيذ الحركة أو الجرد فعليًا').check();
        await approve.click();
        await cash.getByText('سُجلت الحركة وحدّث الرصيد.', {exact:false}).waitFor();
      }
      await requestMovement(1000, 'OPEN-1000');
      assert.equal(balance, null);
      await approveMovement('رصيد افتتاحي موثّق');
      const opening = await cash.getByRole('heading', {name:/الرصيد الدفتري/}).textContent();
      assert.equal(balance.balanceIqd, 1000);
      await cash.getByRole('button', {name:'إضافة نقد', exact:true}).click();
      assert.equal(await cash.getByRole('combobox', {name:'نوع حركة الصندوق'}).inputValue(), 'RECEIPT');
      await cash.getByRole('combobox', {name:'الحساب المقابل للحركة'}).selectOption('COMPANY_BANK');
      await requestMovement(200, 'BANK-200');
      assert.equal(balance.balanceIqd, 1000);
      await approveMovement('قبض نقدي');
      assert.equal(balance.balanceIqd, 1200);
      assert.notEqual(await cash.getByRole('heading', {name:/الرصيد الدفتري/}).textContent(), opening);
      assert.equal(mutations[3].account, 'COMPANY_BANK');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole('link', {name:'جداول التسوية', exact:true}).click();
      const schedules = page.locator('#merchant-settlement-schedules');
      const merchant = schedules.getByRole('combobox', {name:'اختر المتجر'});
      await merchant.locator('option', {hasText:'المطعم التجريبي'}).waitFor({state:'attached'});
      await merchant.selectOption('branch-a');
      await schedules.getByRole('button', {name:'تحميل الجدول'}).click();
      await schedules.getByText('لم يُعتمد جدول لهذا المتجر بعد.').waitFor();
      assert.ok(calls.some(call => call.view === 'orders'));
      assert.ok(calls.some(call => call.view === 'cashboxes'));
      assert.deepEqual(mutations.map(action => action.action), [
        'CREATE_CASHBOX', 'REQUEST_CASH_OPERATION', 'POST_CASH_OPERATION',
        'REQUEST_CASH_OPERATION', 'POST_CASH_OPERATION',
      ]);
      assert.ok(calls.every(call => call.token === 'Bearer test-session'));
      await page.goto(url + '?source=direct#company-cashboxes');
      await page.getByRole('heading', {name:'صناديق الشركة', exact:true}).waitFor();
      assert.equal(await page.locator('#completed-order-settlements').isVisible(), false);
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log('Merchant settlements workspaces passed at 390 and 1280 pixels');
})().catch(error => {console.error(error); process.exitCode = 1; server.close();});
