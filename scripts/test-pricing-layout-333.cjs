'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {prepare}=require('./build-general-pricing-321.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1360,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const values=prepare({version:1,values:{deliveryRules:[],driverRules:[]}},[{regionId:'zone',hasIndex:true}],require('../docs/finance-commercial-pricing-approval-59.json')).values;
 values.driverRules.unshift({...structuredClone(values.driverRules[0]),id:'BRANCH_RULE',scope:{type:'BRANCH',id:'b'},priority:1});
 const expected=structuredClone(values);for(const rules of [expected.deliveryRules,expected.driverRules])for(const r of rules)r.status='DRAFT';
 let saves=0;
 await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'http://fixture.invalid'};window.AWSUtils={scanAll:async table=>table==='WizzCentral_Regions'?[{regionId:'zone',name_ar:'منطقة اختبار',level:3,is_active:true}]:[],getDynamoDBClient:async()=>({scan:()=>({promise:async()=>({Items:[{businessId:'b',businessName:'مطعم اختبار'}]})})})};});
 await page.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('frontend/pages/delivery-pricing.html','utf8').replace(/<script[^>]*src="(?!\.\.\/(?:delivery-pricing|pricing-region-picker).js)[^"]*"[^>]*><\/script>/g,'').replace(/<section id="(delivery|driver|cash-rounding|simulator|pricing-versions)" hidden/g,'<section id="$1"').replace('id="pricing-scope-panel" class="pricing-workflow" hidden','id="pricing-scope-panel" class="pricing-workflow"')});
 if(u.pathname==='/pricing-region-picker.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/pricing-region-picker.js','utf8')});
 if(u.pathname==='/delivery-pricing.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/delivery-pricing.js','utf8')});
 if(u.pathname==='/styles/pricing-layout.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('frontend/styles/pricing-layout.css','utf8')});
 if(u.pathname==='/staff/pricing/simulate'){const m=n=>({currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:n*1000});return route.fulfill({json:{version:2,delivery:{customerDeliveryFee:m(2250),rule:{id:'delivery',version:1}},driver:{driverEarning:m(2500),rule:{id:'driver',version:1},components:Object.fromEntries(['base','pickup','delivery','time','longDistance','peak','limitAdjustment'].map(k=>[k,m(0)]))}}});}
 if(u.pathname==='/staff/pricing/draft'){saves++;assert.deepEqual(req.postDataJSON().values,expected);return route.fulfill({json:{status:'PUBLISHED',policy:{version:3}}});}
 if(u.pathname==='/staff/pricing')return route.fulfill({json:{current:{version:2,values},can:{direct:true,request:true,approve:true,simulate:true}}});
 return route.abort();});
 await page.goto('http://fixture.invalid/');await page.locator('#pricing-driver-list h3').filter({hasText:'مطعم اختبار'}).waitFor({state:'attached'});
 const cards=page.locator('#pricing-driver-list .pricing-rule-card');assert.equal(await cards.count(),2);assert.match(await cards.first().locator('h3').textContent(),/العامة/);
 assert.match(await cards.first().textContent(),/الوصول إلى المطعم/);assert.equal(await cards.first().locator('.pricing-rule-technical').isVisible(),false);
 await page.locator('#driver').screenshot({path:'/private/tmp/pricing333/desktop.png'});
 // Sorting the presentation must preserve each original rule index and values.
 await cards.first().getByRole('button',{name:'تعديل القاعدة'}).click();assert.equal(await page.locator('#rule-id').inputValue(),'APPROVED_BASELINE_GLOBAL_DRIVER');
 assert.equal(await page.locator('#rule-pickupIncludedMeters').inputValue(),'1000');assert.equal(await page.locator('#rule-pickupPerKm').inputValue(),'250');assert.ok(await page.locator('.pricing-editor-group').count()>=4);
 await page.locator('#pricing-rule-form button[type=submit]').click();
 await page.locator('#pricing-reason').fill('اختبار حفظ القيم دون تغيير');await page.locator('#pricing-save').click();await page.waitForFunction(()=>document.getElementById('pricing-message').textContent.includes('تم حفظ الأسعار'));assert.equal(saves,1);
 for(const id of ['branchId','merchantId','zoneId','cityId','governorateId','vehicleType'])await page.locator('#sim-'+id).fill('fixture');
 await page.locator('#sim-at').fill('2026-10-23T12:00');for(const id of ['pickupMeters','pickupSeconds','deliveryMeters','deliverySeconds'])await page.locator('#sim-'+id).fill('1000');
 await page.locator('#pricing-simulate').click();await page.locator('#pricing-sim-result').filter({hasText:'فرق أساسي تتحمله المنصة: ٢٥٠'}).waitFor();
 await page.locator('#pricing-branch').selectOption('b');assert.equal(await cards.count(),2);assert.match(await cards.first().locator('h3').textContent(),/مطعم اختبار/);
 await page.locator('#pricing-branch').selectOption('');await page.setViewportSize({width:390,height:844});await page.locator('#driver').screenshot({path:'/private/tmp/pricing333/mobile.png'});
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(width.scroll<=width.client+1,JSON.stringify(width));assert.deepEqual(errors,[]);
 console.log('PASS: desktop/mobile cards, branch names, general-first ordering, correct edit index, unchanged save payload, branch filtering, no horizontal overflow. Mock writes only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
