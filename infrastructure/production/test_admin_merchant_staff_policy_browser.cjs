'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const {readFile} = require('node:fs/promises');
const {chromium} = require('playwright');
const {policyCatalog} = require('./merchant-staff-policy/api.cjs');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const site = 'https://wizz.test';
const initial = {version: 1, enabledPermissions: policyCatalog.registry.map(cap => cap.id),
  roles: policyCatalog.presets.map(({pendingPermissions, ...role}) => role)};
const click = locator => locator.evaluate(control => {
  if (control.disabled || !control.getClientRects().length) throw Error('Expected enabled visible control');
  control.click();
});

async function main() {
  const browser = await chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? {args: ['--disable-gpu']} : {channel: 'chrome'});
  try {
    for (const width of [320, 1280]) {
      const page = await browser.newPage({viewport: {width, height: 860}});
      page.setDefaultTimeout(10000);
      const errors = [], changes = [];
      page.on('pageerror', error => errors.push(error));
      let current = structuredClone(initial), canManage = true;
      await page.route(site + '/**', async route => {
        const req = route.request(), pathname = new URL(req.url()).pathname;
        if (pathname === '/assets/js/auth-utils.js') {
          return route.fulfill({contentType: 'application/javascript',
            body: 'window.Auth={ensureSession:async()=>{},getToken:()=>"test-token"}'});
        }
        if (pathname === '/staff/merchants/staff-policy') {
          assert.equal(req.headers().authorization, 'Bearer test-token');
          return route.fulfill({json: {current, capabilities: policyCatalog.registry,
            rolePresets: policyCatalog.presets, canManage, initialized: true}});
        }
        if (pathname.endsWith('/staff-policy/save')) {
          const input = req.postDataJSON();
          assert.equal(input.baseVersion, current.version);
          changes.push(input);
          current = {version: current.version + 1, ...input.values};
          return route.fulfill({json: {current}});
        }
        if (pathname.endsWith('/staff-policy/history')) {
          return route.fulfill({json: {items: [{version: 1,
            updatedAt: '2026-11-24T20:00:00Z', reason: 'تهيئة سياسة التسويات'}]}});
        }
        if (pathname === '/staff/merchants/directory' || pathname === '/staff/merchants/applications') {
          return route.fulfill({json: {items: []}});
        }
        const contentType = {'.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8',
          '.ttf': 'font/ttf'}[path.extname(pathname)];
        return route.fulfill({contentType, body: await readFile(path.join(root, pathname))});
      });

      await page.goto(site + '/pages/merchants.html?tab=staff-policy');
      await page.getByRole('heading', {name: 'الصلاحيات المتاحة للتفويض'}).waitFor();
      assert.equal(await page.getByRole('tab', {name: 'صلاحيات الموظفين'}).getAttribute('aria-selected'), 'true');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      const global = page.locator('#staff-policy-global');
      assert.equal(await global.getByRole('group', {name: 'المنتجات'}).getByLabel('تعديل أسعار المنتجات').isVisible(), true);
      assert.equal(await global.getByRole('group', {name: 'ساعات العمل'}).getByLabel('تعديل ساعات العمل', {exact:true}).isVisible(), true);
      const statements = global.getByLabel('عرض كشوف التسوية', {exact: true});
      assert.equal(await statements.isVisible(), true);
      await statements.uncheck({force: true});
      assert.equal(await global.getByLabel('طلب صرف المستحقات').isChecked(), false);
      assert.equal(await global.getByLabel('تأكيد استلام المستحقات').isChecked(), false);
      await global.getByLabel('سبب التغيير').fill('تحديث إتاحة التسويات');
      await click(global.getByRole('button', {name: 'حفظ إتاحة الصلاحيات'}));
      await page.getByText('حُفظت السياسة وسُجّل سبب التغيير.').waitFor();
      assert.equal(changes.length, 1);
      assert.deepEqual(changes[0].values.roles, initial.roles);
      const types = page.locator('#staff-policy-types');
      await types.selectOption('OPERATIONAL_EMPLOYEE');
      const readyPermission = page.locator('#staff-policy-role').getByLabel('تحديد الطلب جاهزًا للاستلام');
      await readyPermission.waitFor();
      assert.equal(await readyPermission.isChecked(), true);
      assert.equal(await page.getByRole('button', {name: 'حفظ نوع الموظف'}).isVisible(), true);

      await click(page.getByRole('button', {name: 'إضافة نوع'}));
      const role = page.locator('#staff-policy-role');
      await role.getByLabel('الاسم بالعربية').fill('قارئ الحسابات');
      await role.getByLabel('الاسم بالإنجليزية').fill('Account reader');
      await role.getByLabel('عرض بيانات الفرع').check({force: true});
      await role.getByLabel('سبب التغيير').fill('إضافة نوع قراءة الحسابات');
      await click(role.getByRole('button', {name: 'حفظ نوع الموظف'}));
      await types.getByRole('option', {name: 'قارئ الحسابات'}).waitFor({state: 'attached'});
      assert.equal(changes.length, 2);
      assert.deepEqual(changes[1].values.roles.at(-1).permissions, ['branch.read']);
      await click(page.getByRole('button', {name: 'عرض السجل'}));
      await page.getByText(/تهيئة سياسة التسويات/).waitFor();

      canManage = false;
      await click(page.getByRole('button', {name: 'تحديث', exact: true}));
      await page.getByText('حسابك مخوّل بعرض السياسة.').waitFor();
      assert.equal(await page.getByRole('button', {name: 'حفظ إتاحة الصلاحيات'}).isVisible(), false);
      assert.equal(await global.getByLabel('عرض بيانات الفرع').isDisabled(), true);
      await click(page.getByRole('tab', {name: 'الفروع المسجّلة'}));
      await page.getByText('لا توجد فروع مسجّلة ضمن صلاحياتك.').waitFor();
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('2 production portal browser scenarios passed (mobile and desktop).');
  } finally {
    await browser.close();
  }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
