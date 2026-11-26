'use strict';

const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const layout = require('../../backend/staff-service/home-layout');
const filters = require('../../backend/staff-service/home-filters');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const origin = 'https://wizz.test';
const state = {
  permissions: { edit: true, publish: true }, version: 0, published: null,
  draft: [], draftFilters: filters.defaults(), defaultWelcome: layout.DEFAULT_COPY, history: [],
  activityTypes: [{ id: 'RESTAURANT', labelAr: 'مطعم' }],
};
const options = { regions: [{ id: 'region', name: 'النجف' }], merchants: [], cuisines: [], brands: [] };

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const slideState = { permissions: { create: true, edit: true, publish: true }, version: 0,
  options, slides: [] };
const imageUrl = 'data:image/gif;base64,' + gif.toString('base64');
async function handleSlides(route) {
  if (route.request().method() === 'GET') return route.fulfill({ json: slideState });
  const input = route.request().postDataJSON();
  if (input.action === 'upload') {
    assert.equal(input.contentType, 'image/gif');
    assert.equal(input.image, gif.toString('base64'));
    return route.fulfill({ json: { imageKey: 'home-slideshow/admin/test.gif', imageUrl } });
  }
  assert.equal(input.baseVersion, slideState.version++);
  if (input.action === 'save') {
    assert.deepEqual(input.slide.regionIds, ['region']);
    assert.equal(input.slide.action.type, 'announcement');
    slideState.slides = [{ id: input.id, draft: { ...input.slide, imageUrl }, published: null, paused: false }];
  } else if (input.action === 'publish') {
    const [row] = slideState.slides;
    row.published = row.draft;
    row.draft = null;
  } else if (input.action === 'pause') {
    slideState.slides[0].paused = true;
  }
  return route.fulfill({ json: { version: slideState.version } });
}
async function handle(route) {
  const request = route.request();
  const file = new URL(request.url()).pathname;
  if (file === '/assets/js/auth-utils.js') {
    return route.fulfill({
      contentType: 'application/javascript',
      body: 'window.Auth={ensureSession:()=>Promise.resolve(),getToken:()=>"test"};',
    });
  }
  if (file.endsWith('/slides')) return handleSlides(route);
  if (file.endsWith('/options')) return route.fulfill({ json: options });
  if (file.startsWith('/staff/')) {
    if (request.method() === 'GET') return route.fulfill({ json: state });
    const body = request.postDataJSON();
    assert.equal(body.baseVersion, state.version++);
    if (file.endsWith('/draft')) {
      state.draft = layout.validate(body.sections);
      state.draftWelcome = layout.validateCopy(body.welcome);
      state.draftNavigation = body.navigation;
      state.draftFilters = filters.validate(body.filters);
    } else {
      state.published = { revision: state.version, sections: state.draft, publishedAt: new Date().toISOString() };
    }
    return route.fulfill({ json: { version: state.version, saved: true } });
  }
  const contentType = {
    '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html; charset=utf-8', '.ttf': 'font/ttf',
  }[path.extname(file)];
  return route.fulfill({ contentType, body: await readFile(path.join(root, file)) });
}
async function main() {
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.route(origin + '/**', handle);
      await page.goto(origin + '/pages/customer-home.html');
      await page.getByRole('button', { name: 'إضافة قسم' }).waitFor({ timeout: 10000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      assert.equal(await page.locator('nav a[aria-current="page"]').innerText(), 'رئيسية تطبيق الزبون');
      if (width === 390) {
        await page.getByRole('button', { name: 'إضافة قسم' }).click();
        await page.getByLabel('اسم القسم').fill('مطاعم قريبة');
        await page.getByText('الترحيب والبحث', { exact: true }).click();
        await page.getByLabel('ترحيب الضيوف').fill('أهلًا بك في ويز');
        await page.getByRole('button', { name: 'حفظ المسودة' }).click();
        await page.getByRole('status').filter({ hasText: 'حُفظت المسودة' }).waitFor({ timeout: 10000 });
        assert.equal(state.published, null);
        await page.getByRole('button', { name: 'مراجعة ونشر' }).click();
        await page.getByRole('dialog').getByText('مطاعم قريبة', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'نشر الإصدار', exact: true }).click();
        await page.getByRole('status').filter({ hasText: 'نُشر الإصدار' }).waitFor({ timeout: 10000 });
        assert.equal(state.published.sections[0].title, 'مطاعم قريبة');
        assert.equal(state.draftWelcome.guest, 'أهلًا بك في ويز');
      }
      await page.getByRole('tab', { name: 'شرائح الإعلانات' }).click();
      await page.getByRole('tabpanel').getByRole('button', { name: 'إضافة شريحة' }).waitFor({ timeout: 10000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      if (width === 390) {
        await page.getByRole('button', { name: 'إضافة شريحة' }).click();
        await page.getByLabel('اسم الشريحة').fill('إعلان تجريبي');
        await page.getByText('المناطق المستهدفة', { exact: false }).click();
        await page.locator('#slide-editor').getByLabel('النجف', { exact: true }).check();
        await page.getByLabel('صورة الشريحة').setInputFiles({ name: 'banner.gif', mimeType: 'image/gif', buffer: gif });
        await page.getByRole('button', { name: 'حفظ المسودة' }).click();
        await page.getByRole('status').filter({ hasText: 'حُفظت المسودة ويمكن مراجعتها' }).waitFor({ timeout: 10000 });
        assert.equal(slideState.slides[0].published, null);
        await page.getByRole('button', { name: 'مراجعة ونشر' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'نشر الشريحة', exact: true }).click();
        await page.getByText('تُعرض الآن', { exact: true }).waitFor({ timeout: 10000 });
        await page.getByRole('button', { name: 'إيقاف العرض' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'إيقاف العرض', exact: true }).click();
        await page.getByText('متوقفة', { exact: true }).waitFor({ timeout: 10000 });
        await page.getByRole('tab', { name: 'الأقسام والاختصارات' }).click();
        assert.equal(await page.getByRole('button', { name: 'مراجعة ونشر' }).isEnabled(), true);
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Home and slide tabs verified at 320, 390 and 1280 px; draft, GIF preview, publish and pause verified.');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
