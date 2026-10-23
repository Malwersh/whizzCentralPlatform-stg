'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage({viewport:{width:1000,height:900}});page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{font-family:Arial;color:#00296b;max-width:850px;margin:20px}input,button{font:inherit;padding:10px}small{display:block}</style><style>'+fs.readFileSync('frontend/styles/pricing-layout.css','utf8')+'</style><label id="original">مناطق التوصيل<input id="zones"></label></html>'}));
 await page.goto('http://localhost/');await page.evaluate(()=>{window.calls=0;window.fail=false;window.Auth={ensureSession:async()=>{}};window.AWSUtils={scanAll:async table=>{window.calls++;if(window.fail)throw Error('offline');return table==='WizzCentral_Regions'?[
 {regionId:'iraq',level:0,name_ar:'العراق'}, {regionId:'najaf',level:1,name_ar:'النجف',parent_id:'iraq'},
 {regionId:'district',level:2,name_ar:'المناذرة',parent_id:'najaf'},
 {regionId:'a',level:3,name_ar:'الحيرة',parent_id:'district',is_active:true},
 {regionId:'b',level:3,name_ar:'مركز المناذرة',parent_id:'district',is_active:true},
 {regionId:'inactive',level:3,name_ar:'منطقة متوقفة',is_active:true},
 {regionId:'blocked',level:3,name_ar:'توصيل متوقف',is_active:true},
 ]:[{regionId:'inactive',effective_is_active:0},{regionId:'blocked',effective_is_active:1,effective_config:{delivery:false}}];}};});
 await page.addScriptTag({content:fs.readFileSync('frontend/pricing-region-picker.js','utf8')});
 await page.evaluate(()=>{window.picker=new window.PricingRegionPicker(document.getElementById('zones'),['b','legacy']);});
 await page.locator('.pricing-region-option').filter({hasText:'الحيرة'}).waitFor();assert.equal(await page.locator('#zones').getAttribute('type'),'hidden');assert.equal(await page.locator('.pricing-region-option').count(),2);assert.match(await page.locator('.pricing-region-list').textContent(),/العراق \/ النجف \/ المناذرة/);assert.equal(await page.locator('#zones').inputValue(),'b,legacy');
 await page.getByRole('searchbox').fill('الحيرة');await page.locator('.pricing-region-option input').check();assert.equal(await page.locator('#zones').inputValue(),'b,legacy,a');
 await page.getByRole('searchbox').fill('لا توجد');assert.match(await page.locator('.pricing-region-list').textContent(),/لا توجد مناطق تطابق/);assert.equal(await page.locator('#zones').inputValue(),'b,legacy,a');
 await page.getByRole('button',{name:'إزالة المنطقة المحفوظة',exact:true}).click();assert.equal(await page.locator('#zones').inputValue(),'b,a');await page.getByRole('searchbox').fill('');
 await page.screenshot({path:'/private/tmp/pricing336/regions-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/private/tmp/pricing336/regions-mobile.png',fullPage:true});
 await page.evaluate(()=>{window.fail=true;});await page.getByRole('button',{name:'إعادة تحميل المناطق'}).click();await page.getByRole('status').filter({hasText:'تعذر تحميل'}).waitFor();assert.equal(await page.locator('#zones').inputValue(),'b,a');
 await page.evaluate(()=>{window.fail=false;});await page.getByRole('button',{name:'إعادة تحميل المناطق'}).click();await page.locator('.pricing-region-option input:checked').first().waitFor();assert.equal(await page.locator('#zones').inputValue(),'b,a');
 await page.evaluate(()=>{window.picker.selected.clear();window.picker.sync();});assert.equal(await page.evaluate(()=>{try{window.picker.validate();return false;}catch(e){return e.message.includes('واحدة');}}),true);
 const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));assert.ok(width.scroll<=width.client+1);assert.deepEqual(errors,[]);console.log('PASS: named hierarchical multiple selection, search preserves picks, inactive/delivery-disabled excluded, legacy picks retained, retry preserves IDs, empty selection rejected, mobile layout; read-only fixtures.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
