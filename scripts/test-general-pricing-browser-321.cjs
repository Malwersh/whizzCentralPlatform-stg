'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {prepare}=require('./build-general-pricing-321.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const values=prepare({version:1,values:{deliveryRules:[],driverRules:[]}},[{regionId:'zone',hasIndex:true}],require('../docs/finance-commercial-pricing-approval-59.json')).values;
  let draft={version:1,baseVersion:0,publishedVersion:1,values:{deliveryRules:[],driverRules:[]}};
  await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture',logout:async()=>{}};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'http://fixture.invalid'};});
  await page.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('frontend/pages/delivery-pricing.html','utf8').replace(/<script[^>]*src="(?!\.\.\/delivery-pricing.js)[^"]*"[^>]*><\/script>/g,'')});
   if(url.pathname==='/delivery-pricing.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync('frontend/delivery-pricing.js','utf8')});
   if(url.pathname==='/staff/pricing'){assert.equal(request.method(),'GET');return route.fulfill({json:{current:{version:2,values},draft,can:{direct:true,request:true,approve:true,simulate:true}}});}
   return route.abort();
  });
  await page.goto('http://fixture.invalid/');await page.locator('#pricing-content').waitFor({state:'visible'});
  assert.match(await page.locator('#pricing-delivery-list').textContent(),/APPROVED_BASELINE_GLOBAL_DELIVERY/);
  assert.equal(await page.locator('#pricing-save').textContent(),'حفظ الأسعار');
  assert.equal(await page.locator('#pricing-sim-source').inputValue(),'CURRENT');
  assert.equal(await page.locator('#pricing-sample').count(),0);
  await page.locator('#pricing-delivery-list button').first().click();assert.equal(await page.locator('#rule-base').inputValue(),'1000');
  await page.locator('#pricing-cancel-edit').click();
  // An unrelated stale open draft must not erase the active general policy either.
  draft={version:2,baseVersion:0,values:{deliveryRules:[],driverRules:[]}};
  await page.locator('#pricing-reload').click();await page.locator('#pricing-content').waitFor({state:'visible'});
  assert.match(await page.locator('#pricing-driver-list').textContent(),/APPROVED_BASELINE_GLOBAL_DRIVER/);
  assert.deepEqual(errors,[]);console.log('PASS: direct active pricing, closed/stale draft exclusion, global rules visible; no real writes.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
