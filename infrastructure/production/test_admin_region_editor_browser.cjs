'use strict';

const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const file = path.join(root, new URL(req.url, 'http://127.0.0.1').pathname);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org");
  res.end(fs.readFileSync(file));
});
const box = (left, bottom, right, top) => ({
  type: 'Polygon', coordinates: [[[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]],
});
const row = (id, name, level, parent, geometry) => ({
  regionId: id, name: id, name_ar: name, level, parent_id: parent, geometry,
  is_active: true, editable: true, effective: { effective_is_active: 1 },
});
const region = row('district', 'قضاء المشخاب', 2, 'province', box(44.30, 31.90, 44.34, 31.94));
const sibling = row('peer', 'القضاء المجاور', 2, 'province', box(44.35, 31.90, 44.40, 31.95));
const parent = row('province', 'المحافظة', 1, null, box(44.20, 31.80, 44.60, 32.15));

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
    const errors = [], drafts = [];
    page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/assets/js/auth-utils.js', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Auth={ensureSession:async()=>{},getToken:()=>"test"}',
    }));
    await page.route('**/staff/regions/manage', route => route.fulfill({
      json: { regions: [region, sibling, parent], drafts: [], jobs: [], digest: 'fixture',
              permissions: { edit: true, publish: true, history: true } },
    }));
    await page.route('**/staff/regions/manage/draft', route => {
      const body = route.request().postDataJSON();
      drafts.push(body);
      return route.fulfill({ json: {
        draft: { status: 'DRAFT', region: body.region, operation: body.operation },
        validation: { errors: [{ message: 'يوجد تداخل مع القضاء المجاور.' }] },
      } });
    });
    await page.route('**/staff/regions/manage/validate', route => route.fulfill({
      json: { valid: false, errors: [{ code: 'REGION_DELETE_HAS_CHILDREN', regionName: 'منطقة تابعة' }] },
    }));
    await page.route('https://tile.openstreetmap.org/**', route => route.abort());
    await page.goto('http://127.0.0.1:' + server.address().port + '/pages/regions.html');
    await page.getByRole('row', { name: /قضاء المشخاب/ }).getByRole('button', { name: 'تعديل' }).click();
    const dialog = page.getByRole('dialog');
    const footer = dialog.locator('.region-editor-footer');
    await footer.getByText('اكتب سبب التعديل أو مصدر الحدود من خمسة أحرف على الأقل.').waitFor().catch(async error => {
      throw Error(JSON.stringify({ footer: await footer.textContent(), errors }), { cause: error });
    });
    assert(await footer.getByRole('button', { name: 'حفظ المسودة' }).isDisabled());
    await dialog.getByLabel('سبب التعديل أو مصدر الحدود').fill('تصحيح الحد المشترك للقضاء');
    await footer.getByRole('button', { name: 'حفظ المسودة الجاهزة' }).waitFor();
    assert(await footer.getByRole('button', { name: 'حفظ المسودة الجاهزة' }).isEnabled());

    await page.evaluate(() => {
      const app = window.regionsManager;
      const validate = app.validate.bind(app);
      app.validate = async (...args) => {
        await new Promise(resolve => setTimeout(resolve, 220));
        return validate(...args);
      };
    });

    async function dragIntoSibling(recover = false) {
      await page.evaluate(() => {
        const map = window.regionsManager.editor.map;
        map.setZoom(map.getZoom() - 1, { animate: false });
      });
      await dialog.locator('.leaflet-draw-edit-edit').click();
      await footer.getByText(/اضغط «اعتماد الرسم»/).waitFor();
      const { from, to } = await page.evaluate(() => {
        const map = window.regionsManager.editor.map;
        const rect = map.getContainer().getBoundingClientRect();
        const absolute = point => ({ x: rect.left + point.x, y: rect.top + point.y });
        return {
          from: absolute(map.latLngToContainerPoint([31.94, 44.34])),
          to: absolute(map.latLngToContainerPoint([31.94, 44.37])),
        };
      });
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 12 });
      await dialog.locator('.region-validation').getByText(/تداخل داخل مساحة.*القضاء المجاور/).waitFor();
      assert.equal(await page.evaluate(() => window.regionsManager.editor.drawn.getLayers()[0].options.color), '#00296b');
      assert(await page.evaluate(() => window.regionsManager.editor.highlights.getLayers().some(layer => layer instanceof L.Polyline && layer.options.color === '#d32f2f')));
      assert(await footer.getByRole('button', { name: 'حفظ المسودة' }).isDisabled());
      await dialog.getByRole('button', { name: 'عرض موضع التنبيه' }).waitFor();
      if (recover) {
        await page.mouse.move(from.x - 8, from.y, { steps: 10 });
        for (let i = 0; i < 12; i++) {
          await page.mouse.move(from.x - 8 + (i % 2) * 2, from.y);
          await new Promise(resolve => setTimeout(resolve, 45));
        }
        assert.equal(await page.evaluate(() => window.regionsManager.editor.drawn.getLayers()[0].options.color), '#00296b');
        assert.equal(await page.evaluate(() => window.regionsManager.editor.highlights.getLayers().length), 0);
      }
      await page.mouse.up();
    }

    await dragIntoSibling(true);
    await dialog.getByText('تراجع', { exact: true }).click();
    await footer.getByRole('button', { name: 'حفظ المسودة الجاهزة' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.regionsManager.editor.region.geometry), region.geometry);
    assert.equal(drafts.length, 0);

    await dragIntoSibling();
    await dialog.getByText('اعتماد الرسم', { exact: true }).click();
    await footer.getByRole('button', { name: 'حفظ مسودة للتصحيح' }).click();
    await dialog.waitFor({ state: 'hidden' });
    await page.getByRole('alert').getByText(/حُفظت مسودة «قضاء المشخاب»/).waitFor();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].region.regionId, region.regionId);
    assert.notDeepEqual(drafts[0].region.geometry, region.geometry);
    assert.equal(drafts[0].reason, 'تصحيح الحد المشترك للقضاء');

    await page.getByRole('row', { name: /قضاء المشخاب/ }).getByRole('button', { name: 'تعديل' }).click();
    await dialog.locator('.leaflet-draw-draw-polygon').click();
    const cursor = await page.evaluate(() => {
      const editor = window.regionsManager.editor;
      const polygon = editor.drawControl._toolbars.draw._modes.polygon.handler;
      polygon.addVertex(L.latLng(31.92, 44.32));
      const rect = editor.map.getContainer().getBoundingClientRect();
      const point = editor.map.latLngToContainerPoint([31.935, 44.37]);
      return { x: rect.left + point.x, y: rect.top + point.y };
    });
    await page.mouse.move(cursor.x, cursor.y);
    await dialog.locator('.region-validation').getByText(/تداخل داخل مساحة.*القضاء المجاور/).waitFor();
    assert(await footer.getByRole('button', { name: 'حفظ المسودة' }).isDisabled());
    const segments = await page.evaluate(() => {
      const editor = window.regionsManager.editor;
      const coordinates = layer => layer.getLatLngs().map(point => point.lng);
      const navy = editor.boundaryLines.getLayers().filter(layer => layer.options.color === '#00296b');
      const red = editor.highlights.getLayers().filter(layer => layer.options.color === '#d32f2f');
      return { navy: navy.map(coordinates), red: red.map(coordinates) };
    });
    assert.equal(segments.navy.length, 1);
    assert.equal(segments.red.length, 1);
    assert(Math.abs(segments.navy[0].at(-1) - 44.35) < 0.000001);
    assert(Math.abs(segments.red[0][0] - 44.35) < 0.000001);
    await dialog.getByRole('button', { name: 'إغلاق' }).click();
    assert.equal(drafts.length, 1);

    const districtRow = page.getByRole('row', { name: /قضاء المشخاب/ });
    await districtRow.getByRole('button', { name: 'تعديل', exact: true }).click();
    const level = dialog.locator('label').filter({ hasText: /^المستوى/ }).locator('select');
    const parentSelect = dialog.locator('label').filter({ hasText: /^المنطقة الأب/ }).locator('select');
    assert(await level.isDisabled());
    assert(await parentSelect.isDisabled());
    const regionName = dialog.getByLabel('اسم المنطقة بالإنجليزية');
    await regionName.fill('Al-Meshkhab');
    await dialog.getByRole('button', { name: 'تغيير التصنيف', exact: true }).click();
    await dialog.getByRole('heading', { name: 'تغيير تصنيف المنطقة' }).waitFor();
    assert.equal(await regionName.inputValue(), 'Al-Meshkhab');
    assert(await level.isEnabled());
    assert(await parentSelect.isEnabled());
    await level.selectOption({ label: 'ناحية أو منطقة' });
    await parentSelect.selectOption('peer');
    await dialog.getByLabel('سبب التعديل أو مصدر الحدود').fill('تحويل السجل إلى ناحية تابعة للقضاء');
    await footer.getByRole('button', { name: /حفظ المسودة الجاهزة|حفظ مسودة للتصحيح/ }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(drafts[1].operation, 'reclassify');
    assert.equal(drafts[1].region.name, 'Al-Meshkhab');
    assert.equal(drafts[1].region.level, 3);
    assert.equal(drafts[1].region.parent_id, 'peer');

    await districtRow.getByRole('button', { name: 'حذف المنطقة', exact: true }).click();
    await dialog.getByText(/انقل المناطق التابعة.*منطقة تابعة/).waitFor();
    await dialog.getByLabel('سبب طلب الحذف').fill('إزالة سجل تغطية يحتاج إلى مراجعة');
    await dialog.getByRole('button', { name: 'حفظ مسودة الحذف' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(drafts[2].region, { regionId: 'district' });
    assert.equal(drafts[2].operation, 'delete');
    assert.deepEqual(errors, []);
    console.log('Verified boundary preview, draft saving, reclassification and deletion review');
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => {
  console.error(error);
  server.close();
  process.exitCode = 1;
});
