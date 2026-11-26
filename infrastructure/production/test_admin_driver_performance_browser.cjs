'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(process.env.WIZZ_ADMIN_WEB_BUILD);
const contentTypes = {
  '.js': 'application/javascript', '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.ttf': 'font/ttf',
};
const server = http.createServer(async (req, res) => {
  const file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  try {
    assert.ok(file.startsWith(root + path.sep));
    const bytes = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': contentTypes[path.extname(file)] ?? 'application/octet-stream' });
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 850 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/assets/js/auth-utils.js', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'window.Auth={ensureSession:async()=>{},getToken:()=>"test",clearTokens:()=>{}}',
      }));
      const driverId = '22222222-2222-4222-8222-222222222222';
      await page.route('**/staff/drivers', r => r.fulfill({
        json: { items: [{ driverId, name: 'سائق الاختبار', phone: '', status: 'APPROVED' }], nextCursor: null },
      }));
      await page.route(`**/staff/drivers/${driverId}/vehicles`, r => r.fulfill({
        json: { profile: { status: 'APPROVED' }, initialized: true, documents: [], vehicles: [], events: [] },
      }));
      const incidentId='11111111-1111-4111-8111-111111111111';
      const appealId='33333333-3333-4333-8333-333333333333';
      let appealOpen=true,ratingReviewOpened=false;
      await page.route(`**/staff/drivers/${driverId}/quality`, async route=>{
        const request=route.request();
        assert.equal(request.headers().authorization,'Bearer test');
        const order={orderId:'order1',orderNumber:'ORD1792497600000',attempt:1,incidentId,category:'ROAD_SAFETY'};
        if(request.method()==='GET')return route.fulfill({json:{
          items:[{...order,appealOpen,state:appealOpen?'APPEAL_OPEN':'RESOLVED'}],
          coverageComplete:true,capabilities:{review:true},
        }});
        const body=request.postDataJSON();
        if(body.action==='READ_DRIVER_TIMING_REVIEW'||body.action==='READ_DRIVER_RATING_REVIEW'){
          const timing=body.action==='READ_DRIVER_TIMING_REVIEW';
          assert.equal(body.orderId,!timing&&ratingReviewOpened?order.orderId:order.orderNumber);
          if(timing)assert.equal(body.attempt,1);
          else assert.equal(body.attempt,undefined);
          return route.fulfill({json:{
            item:{orderId:order.orderId,orderNumber:order.orderNumber,branchName:'مطعم الاختبار',
              ...(timing?{attempt:1,observation:{reason:'ORIGINAL_TARGET_UNAVAILABLE'}}
                :{rating:{stars:4,comment:'تقييم الاختبار',included:!ratingReviewOpened},reviewable:true,
                  review:ratingReviewOpened?{caseId:incidentId,version:1,state:'OPEN',evidence:[],history:[],appeals:[]}:null})},
            capabilities:{review:!timing},
          }});
        }
        if(body.action==='OPEN_DRIVER_RATING_REVIEW'){
          assert.equal(body.orderId,order.orderId);
          assert.equal(body.expectedVersion,0);
          assert.equal(body.caseId,undefined);
          assert.equal(body.reason,'مراجعة التقييم من سجل الطلب');
          assert.match(body.idempotencyKey,/^[0-9a-f-]{36}$/i);
          ratingReviewOpened=true;
          return route.fulfill({json:{success:true,version:1}});
        }
        assert.equal(body.incidentId,incidentId);
        if(body.action==='READ_DRIVER_QUALITY_REVIEW')return route.fulfill({json:{
          item:{...order,branchName:'مطعم الاختبار',reviewable:true,review:{
            caseId:incidentId,version:appealOpen?5:6,category:'ROAD_SAFETY',severity:'HIGH',
            state:appealOpen?'APPEAL_OPEN':'RESOLVED',decision:{id:'decision1',value:'SUBSTANTIATED',reason:'راجعت الإدارة الدليلين'},
            evidence:[{id:'e1',party:'CUSTOMER',reference:'إفادة العميل',note:'شهادة'},{id:'e2',party:'EXTERNAL',reference:'إفادة الشاهد',note:'شهادة'}],
            history:[],appeals:[{id:appealId,status:appealOpen?'OPEN':'CLOSED',resolution:'UPHELD',reason:'طلب إعادة النظر'}],
          }},capabilities:{review:true},
        }});
        assert.equal(body.action,'CLOSE_DRIVER_QUALITY_APPEAL');
        assert.equal(body.appealId,appealId);
        assert.equal(body.expectedVersion,5);
        assert.deepEqual(body.evidenceIds,['e1','e2']);
        assert.equal(body.resolution,'UPHELD');
        assert.match(body.idempotencyKey,/^[0-9a-f-]{36}$/i);
        appealOpen=false;
        return route.fulfill({json:{success:true,version:6}});
      });

      let attempt = 0;
      await page.route(`**/staff/drivers/${driverId}/performance`, async r => {
        assert.equal(r.request().headers().authorization, 'Bearer test');
        if (++attempt === 1) {
          await r.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
        } else if (attempt === 2) {
          await r.fulfill({ json: { status: 'UNAVAILABLE', acceptanceRate: null } });
        } else {
          await r.fulfill({ json: { status: 'CURRENT', computedAt: '2026-11-23T20:00:00Z',
            acceptanceRate: 0, acceptanceSample: 3, completionRate: null, rating: null, ratingCount: 0 } });
        }
      });
      await page.goto('http://127.0.0.1:' + server.address().port + '/pages/drivers.html');
      await page.getByRole('button', { name: 'الوثائق والمركبات' }).click();
      await page.locator('#driver-details .review-account').waitFor();
      assert.equal(attempt, 0);

      await page.locator('#performance-view').click();
      await page.locator('#driver-details button').click();
      await page.getByText('لا توجد مؤشرات محسوبة بعد', { exact: true }).waitFor();
      assert.equal(await page.locator('#driver-details dl').count(), 0);

      await page.locator('#review-view').click();
      await page.locator('#driver-details .review-account').waitFor();
      await page.locator('#performance-view').click();
      await page.locator('#driver-details dl').waitFor();
      assert.equal(await page.locator('#performance-view').getAttribute('aria-pressed'), 'true');
      assert.match(await page.locator('#driver-details dl').innerText(), /بيانات غير كافية/);
      assert.match(await page.locator('#driver-details dl dd').first().innerText(), /[٠0].*[%٪]/);
      assert.equal(await page.locator('#driver-details .review-account').count(), 0);
      for(const [section,label] of [
        ['مراجعة التأخير','لا توجد مواعيد أصلية محفوظة لهذه الرحلة.'],
        ['مراجعة تقييم الزبون','تقييم الاختبار'],
      ]){
        const review=page.locator('#driver-details > details').filter({has:page.locator('summary',{hasText:section})});
        await review.locator('summary').first().click();
        await review.getByLabel('رقم الطلب').fill('ORD1792497600000');
        await review.getByRole('button',{name:'عرض المراجعة'}).click();
        await review.getByText(label,{exact:true}).waitFor();
        assert.equal(await review.getByText('فتح مراجعة',{exact:true}).count(),section==='مراجعة التأخير'?0:2);
        if(section==='مراجعة تقييم الزبون'){
          await review.locator('summary').filter({hasText:/^فتح مراجعة$/}).click();
          await review.getByLabel('سبب الإجراء').fill('مراجعة التقييم من سجل الطلب');
          await review.getByRole('button',{name:'فتح مراجعة',exact:true}).click();
          await review.getByText('مستبعد من متوسط السائق.',{exact:true}).waitFor();
        }
      }
      await page.locator('#quality-view').click();
      await page.getByRole('button',{name:'مراجعة الاعتراض'}).click();
      const resolve=page.locator('details.review-decision').filter({has:page.locator('summary',{hasText:'حسم الاعتراض'})});
      await resolve.locator('summary').click();
      await resolve.getByLabel('نتيجة الاعتراض').selectOption('UPHELD');
      for(const evidence of await resolve.locator('input[type=checkbox]').all())await evidence.check();
      await resolve.getByLabel('سبب الإجراء').fill('راجعت الإفادتين وأيدت القرار');
      await resolve.getByRole('button',{name:'حسم الاعتراض'}).click();
      await page.getByText('تم حفظ الإجراء.',{exact:true}).waitFor();
      assert.equal(await page.getByRole('button',{name:'مراجعة الاعتراض'}).count(),0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errors, []);
      await page.locator('#close').click();
      assert.equal(await page.locator('#detail').isVisible(), false);
      await page.close();
    }
    console.log('Driver file verified on Chrome at 320, 390 and 1280 pixels');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
