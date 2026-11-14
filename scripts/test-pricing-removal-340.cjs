'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const {prepare}=require('./build-general-pricing-321.cjs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
 const page=await browser.newPage({viewport:{width:1360,height:1100}}),errors=[];page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 const values=prepare({version:1,values:{deliveryRules:[],driverRules:[]}},[{regionId:'zone',hasIndex:true}],require('../docs/finance-commercial-pricing-approval-59.json')).values;
 values.driverRules.unshift({...structuredClone(values.driverRules[0]),id:'BRANCH_RULE',scope:{type:'BRANCH',id:'b'},priority:1});
 const expected=structuredClone(values);for(const rules of [expected.deliveryRules,expected.driverRules])for(const r of rules)r.status='DRAFT';
 let saves=0;
 await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'http://localhost'};window.AWSUtils={scanAll:async table=>table==='WizzCentral_Regions'?[{regionId:'zone',name_ar:'منطقة اختبار',level:3,is_active:true}]:[],getDynamoDBClient:async()=>({scan:()=>({promise:async()=>({Items:[{businessId:'b',businessName:'مطعم اختبار'},{businessId:'c',businessName:'فرع بلا استثناء'}]})})})};});
 await page.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());
 if(u.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('frontend/pages/delivery-pricing.html','utf8').replace(/<script[^>]*src="(?!\.\.\/(?:delivery-pricing|pricing-workspace|pricing-region-picker|pricing-field-help).js)[^"]*"[^>]*><\/script>/g,'')});
 if(u.pathname==='/pricing-workspace.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/pricing-workspace.js','utf8')});
 if(u.pathname==='/pricing-region-picker.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/pricing-region-picker.js','utf8')});
 if(u.pathname==='/pricing-field-help.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/pricing-field-help.js','utf8')});
 if(u.pathname==='/delivery-pricing.js')return route.fulfill({contentType:'text/javascript',body:fs.readFileSync('frontend/delivery-pricing.js','utf8')});
 if(u.pathname==='/styles/pricing-layout.css')return route.fulfill({contentType:'text/css',body:fs.readFileSync('frontend/styles/pricing-layout.css','utf8')});
 if(u.pathname==='/staff/pricing/simulate'){const m=n=>({currency:'IQD',scale:1000,moneySchemaVersion:1,minorAmount:n*1000});return route.fulfill({json:{version:2,delivery:{customerDeliveryFee:m(2250),rule:{id:'delivery',version:1}},driver:{driverEarning:m(2500),rule:{id:'driver',version:1},components:Object.fromEntries(['base','pickup','delivery','time','longDistance','peak','limitAdjustment'].map(k=>[k,m(0)]))}}});}
 if(u.pathname==='/staff/pricing/draft'){saves++;assert.deepEqual(req.postDataJSON().values,expected);Object.assign(values,structuredClone(req.postDataJSON().values));return route.fulfill({json:{status:'PUBLISHED',policy:{version:3}}});}
 if(u.pathname==='/staff/pricing')return route.fulfill({json:{current:{version:2,values},can:{direct:true,request:true,approve:true,simulate:true}}});
 return route.abort();});
 await page.goto('http://localhost/');await page.locator('#pricing-content').waitFor({state:'visible'});
 assert.equal(await page.locator('#pricing-home').isVisible(),true);for(const id of ['delivery','driver','cash-rounding','simulator','pricing-versions','pricing-scope-panel'])assert.equal(await page.locator('#'+id).isVisible(),false);
 await page.screenshot({path:'/private/tmp/pricing335/home-desktop.png',fullPage:true});
 await page.locator('#pricing-home [data-pricing-view=driver]').click();assert.equal(await page.locator('#driver').isVisible(),true);assert.equal(await page.locator('#delivery').isVisible(),false);await page.locator('#pricing-driver-list h3').filter({hasText:'مطعم اختبار'}).waitFor({state:'attached'});
 const cards=page.locator('#pricing-driver-list .pricing-rule-card');assert.equal(await cards.count(),2);assert.match(await cards.first().locator('h3').textContent(),/العامة/);
 assert.match(await cards.first().textContent(),/الوصول إلى المطعم/);assert.equal(await cards.first().locator('.pricing-rule-technical').isVisible(),false);
 await page.locator('#driver').screenshot({path:'/private/tmp/pricing335/desktop.png'});
 // Sorting the presentation must preserve each original rule index and values.
 await cards.first().getByRole('button',{name:'تعديل القاعدة'}).click();assert.equal(await page.locator('#rule-id').inputValue(),'APPROVED_BASELINE_GLOBAL_DRIVER');
 assert.equal(await page.locator('#rule-pickupIncludedMeters').inputValue(),'1000');assert.equal(await page.locator('#rule-pickupPerKm').inputValue(),'250');assert.ok(await page.locator('.pricing-editor-group').count()>=4);
 await page.locator('#pricing-rule-form button[type=submit]').click();
 await page.locator('#pricing-reason').fill('اختبار حفظ القيم دون تغيير');await page.locator('#pricing-save').click();await page.waitForFunction(()=>document.getElementById('pricing-message').textContent.includes('تم حفظ الأسعار'));assert.equal(saves,1);
 await page.locator('.pricing-workspace-nav [data-pricing-view=simulator]').click();for(const id of ['branchId','merchantId','zoneId','cityId','governorateId','vehicleType'])await page.locator('#sim-'+id).fill('fixture');
 await page.locator('#sim-at').fill('2026-10-23T12:00');for(const id of ['pickupMeters','pickupSeconds','deliveryMeters','deliverySeconds'])await page.locator('#sim-'+id).fill('1000');
 await page.locator('#pricing-simulate').click();await page.locator('#pricing-sim-result').filter({hasText:'فرق أساسي تتحمله المنصة: ٢٥٠'}).waitFor();
 await page.locator('.pricing-workspace-nav [data-pricing-view=driver]').click();await page.locator('#pricing-branch').selectOption('b');assert.equal(await cards.count(),2);assert.match(await cards.first().locator('h3').textContent(),/مطعم اختبار/);
 await page.locator('#pricing-branch').selectOption('c');assert.equal(await cards.count(),1);assert.match(await cards.first().textContent(),/أجرة السائق العامة/);
 await page.locator('#pricing-add-driver').click();assert.equal(await page.locator('#rule-scope').inputValue(),'BRANCH');assert.equal(await page.locator('#rule-scopeId').inputValue(),'c');assert.equal(await page.locator('#rule-base').inputValue(),'1000');
 await page.locator('.pricing-editor-advanced > summary').click();await page.locator('#rule-scope').selectOption('GLOBAL');assert.equal(await page.locator('#rule-scopeId').inputValue(),'GLOBAL');assert.equal(await page.locator('#rule-scopeId').getAttribute('readonly'),'');await page.locator('#pricing-cancel-edit').click();
 await page.locator('#pricing-branch').selectOption('');await page.setViewportSize({width:390,height:844});await page.locator('#driver').screenshot({path:'/private/tmp/pricing335/mobile.png'});
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(width.scroll<=width.client+1,JSON.stringify(width));await page.locator('.pricing-workspace-nav [data-pricing-view=delivery]').click();assert.equal(await page.locator('#driver').isVisible(),false);await page.locator('#pricing-delivery-list .pricing-rule-actions button').first().click();await page.locator('.pricing-editor-advanced > summary').click();assert.equal(await page.locator('#pricing-tiers').count(),1);await page.locator('#pricing-cancel-edit').click();await page.locator('#pricing-delivery-list .pricing-rule-actions button').first().click();assert.equal(await page.locator('#pricing-tiers').count(),1);assert.equal(await page.locator('#pricing-peak-rows').count(),1);await page.locator('#pricing-cancel-edit').click();
 await page.locator('.pricing-workspace-nav [data-pricing-view=home]').click();await page.screenshot({path:'/private/tmp/pricing335/home-mobile.png',fullPage:true});
 await page.locator('.pricing-workspace-nav [data-pricing-view=driver]').click();await page.locator('#pricing-branch').selectOption('b');
 let dialogs=0;page.on('dialog',async dialog=>{dialogs++;await dialog.dismiss();});
 await page.locator('#pricing-driver-list .pricing-rule-card').first().getByRole('button',{name:'إزالة القاعدة',exact:true}).click();
 assert.equal(await cards.count(),1);assert.match(await page.locator('#pricing-removed-rules').textContent(),/إزالة بانتظار الحفظ/);assert.equal(saves,1);assert.equal(dialogs,0);
 await page.getByRole('button',{name:'تراجع عن الإزالة'}).click();assert.equal(await cards.count(),2);assert.equal(await page.locator('#pricing-removed-rules').isVisible(),false);
 await page.locator('#pricing-driver-list .pricing-rule-card').first().getByRole('button',{name:'إزالة القاعدة',exact:true}).click();expected.driverRules=expected.driverRules.filter(r=>r.id!=='BRANCH_RULE');
 await page.locator('#pricing-reason').fill('حذف استثناء الفرع للاختبار');await page.locator('#pricing-save').click();await page.waitForFunction(()=>document.getElementById('pricing-message').textContent.includes('تم حفظ الأسعار'));assert.equal(saves,2);assert.equal(await cards.count(),1);assert.equal(await page.locator('#pricing-removed-rules').isVisible(),false);assert.equal(dialogs,0);
 await page.locator('.pricing-workspace-nav [data-pricing-view=cash-rounding]').click();assert.equal(await page.locator('#cash-rounding').isVisible(),true);assert.equal(await page.locator('#pricing-edit-actions').isVisible(),false);assert.equal(await page.locator('#pricing-scope-panel').isVisible(),false);assert.deepEqual(errors,[]);
 console.log('PASS: remove immediately stages without native dialog; undo restores; save removes exact branch rule and retains general + delivery; reload reflects saved fixture.  desktop/mobile cards, branch names, general-first ordering, correct edit index, unchanged save payload, branch filtering, inherited general visibility, new branch template, valid GLOBAL scope, no horizontal overflow. Mock writes only.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
