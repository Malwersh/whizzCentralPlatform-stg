'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const {DEFAULTS,CATALOG}=require('../backend/staff-service/notification-settings-contract');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const p=await browser.newPage(),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
 const html=fs.readFileSync('frontend/pages/notification-sounds.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link\b[^>]*>/g,'');
 await p.route('https://sounds99.test/**',r=>{const path=new URL(r.request().url()).pathname;if(path.includes('/staff/settings/notification-sounds')){if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());return r.fulfill({status:409,json:{error:'VERSION_OR_STATE_CONFLICT'}});}return r.fulfill({json:path.endsWith('/changes')?{items:[]}:{current:{version:1,values:DEFAULTS},catalog:CATALOG,canRequest:true,canApprove:true,directWrite:true}});}return r.fulfill({contentType:'text/html',body:html});});
 await p.goto('https://sounds99.test/');await p.evaluate(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://sounds99.test'};window.Audio=class{constructor(src){window.previewSound=src;}async play(){}pause(){}};});await p.addScriptTag({content:fs.readFileSync('frontend/notification-sounds.js','utf8')});await p.locator('#sound-form').waitFor({state:'visible'});
 assert.equal(await p.inputValue('#acceptance'),'5');assert.equal(await p.locator('.sound').count(),3);
 await p.selectOption('#driverGoOnline','soft_chime');await p.locator('.sound').nth(2).getByRole('button',{name:'استمع'}).click();assert.match(await p.evaluate(()=>window.previewSound),/soft_chime\.wav$/);
 await p.fill('#acceptance','8');await p.fill('#sound-reason','اختبار مهلة استقبال الطلبات');await p.locator('#sound-save').click();await p.getByRole('status').filter({hasText:'تغيرت الإعدادات'}).waitFor();assert.equal(writes.length,1);assert.equal(writes[0].values.merchantAcceptanceSeconds,480);assert.equal(writes[0].values.driverGoOnline,'soft_chime');assert.equal(writes[0].baseVersion,1);
 for(const width of [375,1280]){await p.setViewportSize({width,height:1000});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}
 await p.screenshot({path:'/private/tmp/finance98/notification-sounds99.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: policy choices, sound preview, seconds conversion, stale-write handling and responsive layout');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
