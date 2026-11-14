'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent('<div id="host" dir="rtl"></div>');
 await page.evaluate(()=>{
 window.Auth={ensureSession:async()=>{},getToken:()=> 'test'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://example.test'};Object.defineProperty(crypto,'randomUUID',{value:()=> 'abcdefab-1234-4123-8123-123456789abc'});window.calls=[];
 const r={branchId:'branch1',collectionId:'MCG:'+'a'.repeat(48),version:1,status:'DISCOVERING',period:{startLocalDate:'2026-10-01',endExclusiveLocalDate:'2026-10-20'},orderCount:0,zeroNetCount:0,claimedCount:0,amounts:{}};
 window.fetch=async(url,o={})=>{const b=o.body?JSON.parse(o.body):null;window.calls.push({url,b});let d={collection:{...r}};
 if(b?.action==='ADVANCE_PERIOD_COLLECTION'){r.version++;r.status=r.status==='DISCOVERING'?'READY':'FROZEN';Object.assign(r,{orderCount:26,zeroNetCount:1,createdBatchCount:3,includedExistingCount:0,amounts:{merchantNet:{minorAmount:225000000}}});d={collection:{...r}};}
 if(b?.action==='FREEZE_PERIOD_COLLECTION'){r.status='FREEZING';r.version++;d={collection:{...r}};}
 if(new URL(url).searchParams.get('view')==='period-collection-parts')d={items:[{createdBatchId:'MSB:child',existingBatchIds:['MSB:prior']}],nextCursor:null};
 return {ok:true,json:async()=>structuredClone(d)};};
 });
 await page.addScriptTag({path:'frontend/merchant-period-collection.js'});await page.evaluate(()=>window.renderMerchantPeriodCollection({host:document.querySelector('#host'),branchId:'branch1',minor:m=>BigInt(m.minorAmount),format:n=>String(n/1000n)+' د.ع'}));
 await page.locator('select').selectOption('OPENING');await page.locator('input[type=date]').fill('2026-10-01');await page.getByRole('button',{name:'بدء التجميع',exact:true}).click();await page.getByRole('button',{name:'تثبيت جميع طلبات الفترة للمراجعة'}).waitFor();assert.match(await page.locator('#host').textContent(),/26/);assert.match(await page.locator('#host').textContent(),/225000/);await page.getByRole('button',{name:'تثبيت جميع طلبات الفترة للمراجعة'}).click();await page.getByRole('button',{name:'عرض مراجع جميع الكشوف'}).click();await page.getByText('MSB:prior',{exact:true}).waitFor();
 const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls.filter(c=>c.b).map(c=>c.b.action),['START_PERIOD_COLLECTION','ADVANCE_PERIOD_COLLECTION','FREEZE_PERIOD_COLLECTION','ADVANCE_PERIOD_COLLECTION']);assert(calls.every(c=>!c.b||!('amount' in c.b)&&!('actorId' in c.b)&&!('orderIds' in c.b)));assert.deepEqual(errors,[]);console.log('PASS whole-period UI: all26, zero-net visibility, explicit freeze, child references, no payout request.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
