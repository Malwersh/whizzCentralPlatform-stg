'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { fixture } = require('../backend/region-management/test/fixture.cjs');
const { TABLES } = require('../backend/region-management/repository');

const f = fixture();
const root = path.resolve(process.env.REGION_UI_ROOT);
const start = [44.01, 31];
const bend = [44.012, 31.005];
const end = [44.01, 31.01];
const original = { type: 'Polygon', coordinates: [[[44, 31], start, bend, end, [44, 31.01], [44, 31]]] };
f.put(TABLES.base, { ...f.get(TABLES.base, { regionId: 'a' }), geometry: original });
let showPeers = false;
const fullPage = fs.readFileSync(path.join(root, 'pages/regions.html'), 'utf8');
const html = fullPage.replace(/<script\b[\s\S]*?<\/script>/g, block =>
 /src=["'][^"']*(?:leaflet|region-management-312|region-geometry-runtime-312)/.test(block) ? block : '')
 .replace('</head>', '<script>window.Auth={ensureSession:async()=>{},getToken:()=> "test-token"};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:""};</script></head>');
const server = http.createServer(async (request, response) => {
 try {
  const { pathname } = new URL(request.url, 'http://localhost');
  if (pathname.startsWith('/staff/regions/manage')) {
   assert.equal(request.headers.authorization, 'Bearer test-token');
   const action = pathname.split('/').filter(Boolean)[3] || 'get';
   let body = '';
   for await (const chunk of request) body += chunk;
   const result = await f.route(action, body ? JSON.parse(body) : undefined);
   if (action === 'get' && !showPeers) result.regions = result.regions.filter(region => region.regionId !== 'a');
   response.setHeader('Content-Type', 'application/json');
   response.end(JSON.stringify(result));
   return;
  }
  if (pathname === '/pages/regions.html') {
   response.setHeader('Content-Type', 'text/html; charset=utf-8');
   response.end(html);
   return;
  }
  const file = path.join(root, pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
   response.writeHead(404);
   response.end();
   return;
  }
  if (pathname.endsWith('.js')) response.setHeader('Content-Type', 'text/javascript');
  if (pathname.endsWith('.css')) response.setHeader('Content-Type', 'text/css');
  response.end(fs.readFileSync(file));
 } catch (error) {
  response.writeHead(error.status || 500, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ error: error.code || error.message, details: error.details }));
 }
});

async function mapClick(page, [lng, lat]) {
 await page.locator('#region-editor-map').scrollIntoViewIfNeeded();
 const pixel = await page.evaluate(([longitude, latitude]) => {
  const map = regionsManager.editor.map;
  const point = map.latLngToContainerPoint([latitude, longitude]);
  const box = map.getContainer().getBoundingClientRect();
  return { x: box.left + point.x, y: box.top + point.y };
 }, [lng, lat]);
 await page.mouse.click(pixel.x + 2, pixel.y + 2);
}

(async () => {
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 let browser;
 try {
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1450, height: 1050 } });
  page.setDefaultTimeout(12000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('https://**', route => route.fulfill({ status: 204 }));
  await page.goto('http://127.0.0.1:' + server.address().port + '/pages/regions.html');
  const add = page.getByRole('button', { name: 'إضافة منطقة', exact: true });
  const follow = page.getByRole('button', { name: 'اتبع حدًا منشورًا' });
  const sources = page.getByLabel('الحدود التي ستتبعها');
  const sketch = () => page.evaluate(() => regionsManager.polygonDrawing(regionsManager.editor)._poly.getLatLngs().map(p => [p.lng, p.lat]));
  await page.waitForFunction(() => window.regionsManager?.catalog?.regions.length === 3);
  await add.click();
  await page.waitForFunction(() => regionsManager.editor?.map);
  assert.equal(await follow.isEnabled(), true);
  assert.match(await page.locator('#region-follow-hint').textContent(), /اختر المنطقة الأب/);
  assert.equal(await page.evaluate(() => regionsManager.editor.context.getLayers().length), 1);
  for (const level of ['0', '1', '2', '3']) {
   await page.getByRole('dialog').getByLabel('المستوى').selectOption(level);
   await follow.click();
   const available = await sources.locator('option').evaluateAll(options => options.map(option => option.value).sort());
   assert.deepEqual(available, ['country', 'district', 'gov']);
   await page.getByRole('button', { name: 'إلغاء اختيار الحد' }).click();
  }
  await page.getByLabel('المنطقة الأب').selectOption('district');
  assert.equal(await follow.isEnabled(), true);
  await follow.click();
  assert.equal(await page.evaluate(() => regionsManager.editor.map.getContainer().contains(regionsManager.editor.followUI.panel)), true);
  assert.equal(await sources.inputValue(), 'district');
  assert.equal(await sources.locator('optgroup[label="المنطقة الأب"] option').getAttribute('value'), 'district');
  await mapClick(page, [42, 30]);
  await mapClick(page, [45, 30]);
  await page.getByRole('button', { name: 'اعتماد المقطع ومتابعة الرسم' }).click();
  assert.deepEqual(await sketch(), [[42, 30], [45, 30]]);
  const closePolygon = page.getByRole('button', { name: 'إغلاق المضلع', exact: true });
  assert.equal(await closePolygon.isVisible(), true);
  assert.equal(await closePolygon.isDisabled(), true);
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();

  await add.click();
  await page.waitForFunction(() => regionsManager.editor?.drawControl);
  await page.evaluate(() => {
   const handler = regionsManager.polygonDrawing(regionsManager.editor);
   handler.enable();
   for (const [lng, lat] of [[44, 31], [44.02, 31], [44.02, 31.02], [44, 31.02]]) {
    handler.addVertex(L.latLng(lat, lng));
   }
   handler.completeShape();
  });
  await page.waitForFunction(() => regionsManager.editor.status.textContent.includes('اختر المنطقة الأب الصحيحة'));
  await page.locator('.leaflet-draw-edit-edit').click();
  assert.equal(await page.evaluate(() => regionsManager.editor.mapMode), 'edit');
  await page.getByLabel('المنطقة الأب').selectOption('district');
  await page.waitForFunction(() => regionsManager.editor.mapMode === 'edit' &&
   regionsManager.editor.status.classList.contains('valid'), undefined, { timeout: 3000 });
  assert.equal(await page.locator('#region-editor-map').evaluate(() => regionsManager.editor.save.disabled), true);
  await page.getByLabel('المنطقة الأب').selectOption('');
  await page.waitForFunction(() => regionsManager.editor.status.textContent.includes('اختر المنطقة الأب الصحيحة'));
  await page.getByLabel('المنطقة الأب').selectOption('district');
  await page.waitForFunction(() => regionsManager.editor.status.classList.contains('valid'));
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();

  const nextCorner = [44.022, 31.01];
  const secondReference = {
   type: 'Polygon',
   coordinates: [[end, nextCorner, [44.022, 31.02], [44.01, 31.02], end]],
  };
  f.put(TABLES.base, f.region('b', 3, 'district', secondReference));
  showPeers = true;
  await page.reload();
  await page.waitForFunction(() => window.regionsManager?.catalog?.regions.length === 5);
  await add.click();
  await page.waitForFunction(() => regionsManager.editor?.map);
  await page.getByLabel('اسم المنطقة بالعربية').fill('منطقة تجاور تجريبية');
  await page.getByLabel('اسم المنطقة بالإنجليزية').fill('Boundary test');
  await page.getByLabel('المنطقة الأب').selectOption('district');
  await page.getByLabel('سبب التعديل أو مصدر الحدود').fill('اختبار الحد المنشور المشترك');
  await follow.click();
  assert.equal(await sources.inputValue(), 'a');
  await mapClick(page, start);
  await mapClick(page, end);
  const picked = () => page.evaluate(() => {
   const follow = regionsManager.editor.follow;
   return follow.paths[follow.direction].points.map(p => [p.lng, p.lat]);
  });
  assert.deepEqual(await picked(), [start, bend, end]);
  await page.getByRole('button', { name: 'عرض المسار الآخر' }).click();
  assert.notDeepEqual(await picked(), [start, bend, end]);
  await page.getByRole('button', { name: 'عرض المسار الآخر' }).click();
  await page.getByRole('button', { name: 'اعتماد المقطع ومتابعة الرسم' }).click();
  assert.deepEqual(await sketch(), [start, bend, end]);
  await page.waitForFunction(() => regionsManager.editor.boundaryLines.getLayers().some(layer => layer.options.color === '#15803d') &&
   regionsManager.editor.status.classList.contains('valid'));
  await follow.click();
  await page.getByRole('button', { name: 'إلغاء اختيار الحد' }).click();
  assert.deepEqual(await sketch(), [start, bend, end]);
  await follow.click();
  await sources.selectOption('b');
  await mapClick(page, end);
  await mapClick(page, nextCorner);
  assert.deepEqual(await picked(), [end, nextCorner]);
  await page.getByRole('button', { name: 'اعتماد المقطع ومتابعة الرسم' }).click();
  assert.deepEqual(await sketch(), [start, bend, end, nextCorner]);
  await page.waitForFunction(() => regionsManager.editor.status.classList.contains('valid'));
  await page.evaluate(() => {
   const handler = regionsManager.polygonDrawing(regionsManager.editor);
   handler.addVertex(L.latLng(31, 44.022));
   regionsManager.previewDrawing(L.latLng(31.004,44.004));
  });
  await page.waitForFunction(() => !regionsManager.editor.followUI.drawIssue.hidden &&
   regionsManager.editor.followUI.drawIssue.textContent.includes('تداخل'));
  await page.evaluate(() => {
   const {map} = regionsManager.editor;
   const first = map.latLngToContainerPoint([31,44.01]);
   // The pointer is within the first marker and lies slightly inside the existing region.
   regionsManager.previewDrawing(map.containerPointToLatLng(first.subtract([3,0])));
  });
  await page.waitForFunction(() => {
   const e = regionsManager.editor;
   return e.followUI.drawIssue.hidden && (() => {
    const layers = e.boundaryLines.getLayers();
    const vertices = layers.flatMap((layer, index) => layer.getLatLngs().slice(index ? 1 : 0));
    return layers.some(layer => layer.options.color === '#15803d') &&
     layers.some(layer => layer.options.color === '#00296b') &&
     vertices.length === 6 && vertices[0].equals(vertices.at(-1),0);
   })();
  });
  await closePolygon.click();
  await page.waitForFunction(() => !regionsManager.editor.mapMode &&
   regionsManager.editor.boundaryLines.getLayers().some(layer => layer.options.color === '#15803d'));
  const save = page.getByRole('button', { name: 'حفظ المسودة الجاهزة' });
  await save.click();
  await page.waitForFunction(() => !regionsManager.editor && regionsManager.catalog.drafts.length === 1);
  const data = await f.route('get');
  const region = data.drafts[0].region;
  assert.deepEqual(region.geometry.coordinates[0].slice(0, 4), [start, bend, end, nextCorner]);
  assert.deepEqual(f.get(TABLES.base, { regionId: 'a' }).geometry, original);
  const publication = await f.publish([region.regionId]);
  assert.equal((await f.drain(publication.job.jobId)).status, 'PUBLISHED');
  for (const pair of ['a', 'b'].flatMap(peer => [peer + '#' + region.regionId, region.regionId + '#' + peer])) {
   const relationship = f.get(TABLES.neighbors, { neighbor_pair_id: pair });
   assert.equal(relationship.relationship_type, 'adjacent');
   assert(relationship.shared_boundary_km > 1);
  }
  const lower = [44.315, 31.21], upper = [44.315, 31.22];
  const sourceLower = [44.316, 31.21], sourceBend = [44.317, 31.215], sourceUpper = [44.316, 31.22];
  const farLower = [44.305, 31.21], farUpper = [44.305, 31.22];
  const oldGeometry = { type: 'Polygon', coordinates: [[farLower, lower, [44.315, 31.214], upper, farUpper, farLower]] };
  const newSource = { type: 'Polygon', coordinates: [[sourceLower, [44.33, 31.21], [44.33, 31.22], sourceUpper, sourceBend, sourceLower]] };
  f.put(TABLES.base, { ...f.region('replace-target', 3, 'district', oldGeometry), name_ar: 'ناحية الاستبدال' });
  f.put(TABLES.base, { ...f.region('replace-source', 3, 'district', newSource), name_ar: 'ناحية المرجع' });
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'ناحية الاستبدال' }).getByRole('button', { name: 'تعديل', exact: true }).click();
  await page.waitForFunction(() => regionsManager.editor?.map);
  await follow.click();
  await page.getByRole('button', { name: 'استبدال مقطع من الحد الحالي' }).click();
  assert.equal(await sources.isVisible(), false);
  await mapClick(page, lower);
  await mapClick(page, upper);
  await page.getByRole('button', { name: 'اعتماد المقطع المراد استبداله' }).click();
  await sources.selectOption('replace-source');
  await mapClick(page, sourceUpper);
  await mapClick(page, sourceLower);
  const replace = page.getByRole('button', { name: 'اعتماد الاستبدال', exact: true });
  try {
   await replace.waitFor({ timeout: 2000 });
   await page.waitForFunction(() => !regionsManager.editor.followUI.confirm.disabled, undefined, { timeout: 3000 });
  } catch (error) {
   const selection = await page.evaluate(() => {
    const {follow,followUI}=regionsManager.editor;
    return {start:follow.start,end:follow.end,target:follow.replacement.target?.path.points,text:followUI.status.textContent};
   });
   throw new Error(JSON.stringify(selection),{cause:error});
  }
  assert.deepEqual(await page.evaluate(() => regionsManager.editor.region.geometry), oldGeometry);
  await page.getByRole('button', { name: 'عرض المسار الآخر' }).click();
  await page.waitForFunction(() => regionsManager.editor.followUI.status.textContent.includes('تداخل'));
  assert.equal(await page.getByRole('button', { name: 'اعتماد المقطع للتصحيح' }).isVisible(), true);
  await page.getByRole('button', { name: 'عرض المسار الآخر' }).click();
  await replace.click();
  const changed = await page.evaluate(() => regionsManager.editor.region.geometry);
  assert.deepEqual(changed.coordinates[0], [lower, sourceLower, sourceBend, sourceUpper, upper, farUpper, farLower, lower]);
  await page.getByLabel('سبب التعديل أو مصدر الحدود').fill('اختبار استبدال المقطع فقط');
  await page.getByRole('button', { name: 'حفظ المسودة الجاهزة' }).click();
  await page.waitForFunction(() => !regionsManager.editor);
  const replacement = (await f.route('get')).drafts.find(d => d.region.regionId === 'replace-target');
  assert.deepEqual(replacement.region.geometry, changed);
  assert.deepEqual(f.get(TABLES.base, { regionId: 'replace-target' }).geometry, oldGeometry);
  assert.deepEqual(f.get(TABLES.base, { regionId: 'replace-source' }).geometry, newSource);

  const snapLower = [44.50103, 31.3], snapUpper = [44.50103, 31.30035];
  const nearLower = [44.501, 31.3], nearUpper = [44.501, 31.30035];
  const snapSource = { type: 'Polygon', coordinates: [[snapLower, [44.5013, 31.3],
   [44.5013, 31.30035], snapUpper, snapLower]] };
  const snapTarget = { type: 'Polygon', coordinates: [[[44.5007, 31.3], nearLower, nearUpper,
   [44.5007, 31.30035], [44.5007, 31.3]]] };
  f.put(TABLES.base, { ...f.region('snap-target', 3, 'district', snapTarget), name_ar: 'ناحية الالتقاط اليدوي' });
  f.put(TABLES.base, { ...f.region('snap-source', 3, 'district', snapSource), name_ar: 'ناحية الحد المرجعي' });
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'ناحية الالتقاط اليدوي' }).getByRole('button', { name: 'تعديل', exact: true }).click();
  await page.waitForFunction(() => regionsManager.editor?.map && regionsManager.editor.status.classList.contains('valid'));
  await page.locator('#region-editor-map').scrollIntoViewIfNeeded();
  await page.evaluate(() => regionsManager.editor.map.setView([31.300175,44.501015],19));
  await page.locator('.leaflet-draw-edit-edit').click();
  const dragVertex = async (position, target) => {
   const { from, to } = await page.evaluate(({ position, target }) => {
    const e = regionsManager.editor, layer = e.drawn.getLayers()[0];
    const marker = layer.editing._verticesHandlers[0]._markers.find(m => m.getLatLng().equals(L.latLng(position[1],position[0]),0));
    const icon = marker.getElement().getBoundingClientRect();
    const map = e.map.getContainer().getBoundingClientRect();
    const pixel = e.map.latLngToContainerPoint([target[1],target[0]]);
    return { from: { x: icon.left + icon.width/2, y: icon.top + icon.height/2 },
     to: { x: map.left + pixel.x - 1, y: map.top + pixel.y + 1 } };
   }, { position, target });
   await page.mouse.move(from.x,from.y);
   await page.mouse.down();
   await page.mouse.move(to.x,to.y,{steps:8});
   await page.mouse.up();
  };
  await dragVertex(nearLower,snapLower);
  await dragVertex(nearUpper,snapUpper);
  await page.waitForFunction(() => regionsManager.editor.mapMode === 'edit' &&
   regionsManager.editor.boundaryLines.getLayers().some(layer => layer.options.color === '#15803d'));
  await page.getByText('اعتماد الرسم',{exact:true}).click();
  assert.deepEqual((await page.evaluate(() => regionsManager.editor.region.geometry.coordinates[0])).slice(1,3),[snapLower,snapUpper]);
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();

  await add.click();
  await page.waitForFunction(() => regionsManager.editor?.map);
  await page.getByLabel('المنطقة الأب').selectOption('district');
  await page.evaluate(() => {
   regionsManager.editor.map.setView([31.300175,44.501015],19);
   regionsManager.polygonDrawing(regionsManager.editor).enable();
  });
  await mapClick(page,snapLower);
  await page.waitForFunction(() => {
   const polygon=regionsManager.polygonDrawing(regionsManager.editor);
   return polygon._poly.getLatLngs().length===1&&!polygon._disableMarkers;
  });
  await mapClick(page,snapUpper);
  assert.deepEqual(await sketch(),[snapLower,snapUpper]);
  await page.waitForFunction(() => regionsManager.editor.boundaryLines.getLayers().some(layer => layer.options.color === '#15803d'));
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click();

  assert.deepEqual(errors, []);
  console.log('PASS: manual drawing and vertex dragging snap to exact neighboring points; exact neighboring lines are green before and after closing; partial boundary replacement preserves the remaining vertices and shows invalid replacement; actual map clicks, exact curved boundary copy, reference choices at all levels, parent changes during vertex editing, consecutive published boundaries, on-map overlap warning, exact closing preview, draft save, publication and bidirectional adjacency');
 } finally {
  await browser?.close();
  server.close();
 }
})().catch(error => { console.error(error); process.exitCode = 1; });
