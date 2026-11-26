'use strict';
const {chromium}=require('playwright'),http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=process.env.WIZZ_ADMIN_WEB_BUILD;if(!root)throw Error('WIZZ_ADMIN_WEB_BUILD required');
const headers=JSON.parse(fs.readFileSync(path.join(__dirname,'admin-hosting.template.json'))).Resources.SecurityHeaders.Properties.ResponseHeadersPolicyConfig.SecurityHeadersConfig;
const server=http.createServer((req,res)=>{const name=decodeURIComponent(req.url.split('?')[0]),file=path.resolve(root,'.'+(name==='/'?'/index.html':name));if(!file.startsWith(path.resolve(root)+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Security-Policy',headers.ContentSecurityPolicy.ContentSecurityPolicy);res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.ttf')?'font/ttf':'text/html');res.end(fs.readFileSync(file));});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,channel:'chrome'});let passed=0;const context=await browser.newContext();await context.route('https://cognito-idp.us-east-1.amazonaws.com/**',r=>r.fulfill({status:400,contentType:'application/json',body:JSON.stringify({__type:'NotAuthorizedException',message:'Local test only'})}));
 try{
  for(const width of [390,1280]){
   const page=await context.newPage();await page.setViewportSize({width,height:844});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);await page.locator('#loginBtn').waitFor({state:'visible'});
   assert.equal(await page.evaluate(()=>window.WIZZCENTRAL_CONFIG.STAGE),'production');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await page.evaluate(()=>{window.AmazonCognitoIdentity.CognitoUser.prototype.authenticateUser=function(_details,callbacks){callbacks.totpRequired();};window.AmazonCognitoIdentity.CognitoUser.prototype.signOut=function(){};});
   await page.locator('#email').fill('admin@example.invalid');await page.locator('#password').fill('OnlyATestPassword!123');await page.locator('#loginBtn').click();await page.locator('#mfaForm').waitFor({state:'visible'});await page.locator('#mfaCancel').click();await page.locator('#loginForm').waitFor({state:'visible'});
   assert.deepEqual(errors,[]);await page.screenshot({path:'/private/tmp/wizz-admin-login-'+width+'.png',fullPage:true});await page.close();passed+=2;
  }
  function token(){const enc=o=>Buffer.from(JSON.stringify(o)).toString('base64url');return enc({alg:'none'})+'.'+enc({token_use:'id',iss:'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_njh6vaNWj',aud:'7924qedsr5m1j1bvc3c7va8egk',exp:Math.floor(Date.now()/1000)+3600})+'.test';}
  for(const state of ['disabled','active','invited']){
   const p=await context.newPage();await p.addInitScript(t=>{localStorage.setItem('idToken',t);localStorage.setItem('accessToken','test-only');},token());
   await p.route('**/staff/me',r=>r.fulfill({status:state==='disabled'?503:200,contentType:'application/json',body:JSON.stringify(state==='disabled'?{error:'PRODUCTION_ADMIN_SESSION_UNAVAILABLE'}:{employee:{name:'مالك منصة الإنتاج',displayName:'محمد الاختبار',roles:['bootstrap_admin','platform_manager']},permissions:['merchants.read','regions.read'],activationRequired:state==='invited'})}));
   await p.goto(base+'/pages/dashboard.html');
   if(state==='disabled'){await p.locator('#retry').waitFor({state:'visible'});assert.equal(await p.locator('#account').isVisible(),false);assert.match(await p.locator('#message').innerText(),/لم تُفعّل/);}
   if(state==='active'){
    await p.locator('#account').waitFor({state:'visible'});
    assert.equal(await p.locator('#name').innerText(),'محمد الاختبار');
    assert.equal(await p.locator('#role').innerText(),'(مدير المنصة)');
    assert.equal(await p.locator('#dashboard-activity').isVisible(),false);
    assert.deepEqual(await p.locator('.dashboard-shortcuts a:visible strong').allTextContents(),['المطاعم والفروع','مناطق الخدمة']);
    assert.equal(await p.locator('.platform-sidebar [aria-current="page"]').count(),1);
    assert.equal(await p.locator('main').getByRole('button',{name:'تسجيل الخروج'}).count(),0);
   }
   if(state==='invited'){await p.waitForURL('**/pages/account-security.html');assert.equal(await p.locator('h1').innerText(),'حماية حساب الإدارة');}
   await p.close();passed++;
  }
  for (const width of [390, 1280]) {
   const p = await context.newPage();
   await p.setViewportSize({width,height:844});
   await p.addInitScript(t => {
    localStorage.setItem('idToken', t);
    localStorage.setItem('accessToken', 'test-only');
   }, token());
   await p.route('**/staff/me', r => r.fulfill({json:{
    employee:{name:'مدير الاختبار',scope:{allRegions:true}},
    permissions:['dashboard.read','merchants.read','orders.read','promotions.read','finance.read','support.metrics'],
   }}));
   await p.route('**/staff/merchants/applications*', r => {
    assert.equal(r.request().headers().authorization, 'Bearer test-only');
    return r.fulfill({json:new URL(r.request().url()).searchParams.has('cursor')
     ? {items:[{}, {}], nextCursor:null} : {items:[], nextCursor:'next'}});
   });
   await p.route('**/staff/order-cancellation', r => r.fulfill({json:{items:[],nextCursor:null}}));
   await p.route('**/staff/order-monitoring/followup', r => r.fulfill({json:{items:[{}],nextCursor:null}}));
   let activityRequests = 0;
   await p.route('**/staff/dashboard/activity', r => {
    assert.equal(r.request().headers().authorization,'Bearer test-only');
    if (activityRequests++ === 0) return r.fulfill({status:503,json:{}});
    return r.fulfill({json:{measuredAt:'2026-11-25T23:00:00Z',metrics:{
     orders:{value:0,complete:true},branches:{value:2,complete:true},
     drivers:null,customers:{value:500,complete:false},
     support:{value:1,complete:true},offers:{value:3,complete:true},
     revenue:{value:width===390?-1234500:1234500,complete:width===390},
    }}});
   });
   let complaintRequests = 0;
   await p.route('**/complaints-api/staff?*', r => {
    if (complaintRequests++ === 0) return r.fulfill({status:503,json:{}});
    return r.fulfill({json:{items:[{}],cursor:'c'+complaintRequests}});
   });
   await p.goto(base+'/pages/dashboard.html');
   await p.waitForFunction(() => !document.getElementById('refresh-queues').disabled &&
    document.querySelector('[data-queue="complaints"] [role=status]').textContent === 'تعذّر تحميل العدد');
   const count = id => p.locator('[data-queue="'+id+'"] [role=status]').textContent();
   const digits = new Intl.NumberFormat('ar-IQ');
   assert.equal(await count('applications'),digits.format(2));
   assert.equal(await count('cancellations'),digits.format(0));
   assert.equal(await count('complaints'),'تعذّر تحميل العدد');
   assert.equal(await count('dispatch'),digits.format(1));
   assert.equal(await p.locator('[data-queue="dispatch"] a').getAttribute('href'),'/pages/order-monitoring.html#dispatch-followup');
   await p.getByText('تعذّر تحميل المؤشرات. أعد المحاولة.', {exact:true}).waitFor();
   await p.locator('#refresh-activity').click();
   await p.locator('[data-metric="orders"][data-count="exact"]').waitFor();
   assert.equal(await p.locator('[data-metric="orders"]').textContent(),digits.format(0));
   assert.equal(await p.locator('[data-metric="branches"]').textContent(),digits.format(2));
   assert.equal(await p.locator('[data-metric="drivers"]').textContent(),'العدد غير متاح');
   assert.equal(await p.locator('[data-metric="customers"]').textContent(),'على الأقل '+digits.format(500));
   assert.equal(await p.locator('[data-metric="support"]').textContent(),digits.format(1));
   assert.equal(await p.locator('[data-metric="offers"]').textContent(),digits.format(3));
   const iqd = new Intl.NumberFormat('ar-IQ',{style:'currency',currency:'IQD',minimumFractionDigits:0,maximumFractionDigits:3});
   assert.equal(await p.locator('[data-metric="revenue"]').textContent(),
    width===390?iqd.format(-1234.5):'إجمالي غير مكتمل');
   assert.match(await p.locator('#activity-status').textContent(),/بتوقيت بغداد/);
   const home = p.locator('.platform-sidebar a[href="/pages/customer-home.html"]');
   assert.equal(await home.textContent(),'واجهات تطبيق الزبون');
   assert.equal(await home.evaluate(link => link.previousElementSibling.textContent),'تطبيق الزبون');
   await p.locator('#refresh-queues').click();
   await p.waitForFunction(() => !document.getElementById('refresh-queues').disabled);
   assert.equal(await count('complaints'),'على الأقل '+digits.format(3));
   assert.equal(complaintRequests,4);
   assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   await p.close();
   passed++;
  }
  for(const width of [390,1280]){
   const p=await context.newPage();
   p.setDefaultTimeout(10000);
   await p.setViewportSize({width,height:590});
   await p.addInitScript(t=>{
    if(location.pathname==='/pages/drivers.html'&&!sessionStorage.getItem('seeded')){
     localStorage.setItem('idToken',t);
     localStorage.setItem('accessToken','test-only');
     localStorage.setItem('refreshToken','test-only');
     sessionStorage.setItem('seeded','true');
    }
   },token());
   await p.goto(base+'/pages/drivers.html');
   const logout=p.getByRole('button',{name:'تسجيل الخروج'});
   await logout.waitFor({state:'visible'});
   assert.equal(await logout.evaluate(button=>button.parentElement===button.closest('aside').lastElementChild),true);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   if(width===1280){
    assert.equal(await p.locator('.platform-sidebar nav').evaluate(nav=>nav.scrollHeight>nav.clientHeight),true);
    const box=await logout.boundingBox();
    assert.ok(box.y+box.height<=590);
   }
   await logout.click();
   await p.waitForURL('**/index.html');
   assert.equal(await p.evaluate(()=>['idToken','accessToken','refreshToken'].every(key=>!localStorage.getItem(key)&&!sessionStorage.getItem(key))),true);
   await p.close();passed++;
  }
  console.log(JSON.stringify({browserChecksPassed:passed,realLoginTested:false,liveMfaEnrollmentTested:false}));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
