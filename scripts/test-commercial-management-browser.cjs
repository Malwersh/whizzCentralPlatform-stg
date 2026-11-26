'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{
 for(const kind of ['AGREEMENT','FUNDING']){
  const page=await browser.newPage();await page.route('https://commercial.test/**',route=>route.fulfill({contentType:'text/html',body:'<details open data-commercial-kind="'+kind+'"></details>'}));await page.goto('https://commercial.test');
  await page.evaluate(()=>{window.commercialMerchantSource={status:'READY',items:[{businessId:'branch',businessName:'فتوش',address:{fullAddress:'المناذرة'},ownerId:'owner',organizationId:'org'},{businessId:'other',businessName:'فتوش',address:{fullAddress:'المشخاب'},ownerId:'owner',organizationId:'org'}]};window.AWSUtils={getDynamoDBClient:async()=>({scan:()=>({promise:async()=>({Items:[{discountId:'campaign',businessId:'branch',title:'خصم الاختبار',version:2}]})})})};window.requests=[];window.Auth={ensureSession:async()=>{},getToken:()=> 'test-not-a-token'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://api.test'};window.fetch=async(url,options)=>{if(options.method==='GET'&&url.includes('view=funding-options'))return {ok:true,json:async()=>({businessId:'branch',options:[{key:'MERCHANT:campaign',id:'campaign',source:'MERCHANT',label:'خصم الاختبار',version:2}]})};if(options.method==='GET')return {ok:true,json:async()=>({businessId:'branch',merchantId:'merchant',can:{request:true,approve:false,fundingRequest:true,fundingApprove:false},items:[]})};window.requests.push(JSON.parse(options.body));return {ok:false,json:async()=>({error:'VERSION_OR_STATE_CONFLICT'})};};});
  await page.addScriptTag({content:fs.readFileSync('frontend/commercial-funding-picker.js','utf8')});await page.addScriptTag({content:fs.readFileSync('frontend/commercial-management.js','utf8')});
  await page.locator('#commercial-businessId').selectOption('branch');await page.getByText('تحميل الاتفاقيات والتمويل',{exact:true}).click();await page.getByText('إعداد مسودة جديدة',{exact:true}).click();
  const fill=async(n,v)=>page.locator('#commercial-'+n).fill(v);await fill('from','2026-10-01T00:00');await fill('reason','اختبار الواجهة');
  if(kind==='AGREEMENT'){await fill('commission','7.5');await fill('service','500');}else{await page.locator('#commercial-campaign').selectOption('MERCHANT:campaign');await page.locator('#commercial-fundingMode').selectOption('SHARED');await fill('merchantPercent','50');await fill('to','2026-11-01T00:00');}
  await page.getByText('حفظ المسودة للمراجعة',{exact:true}).click();await page.getByRole('status').filter({hasText:'تغير الإصدار'}).waitFor();
  await page.getByText('حفظ المسودة للمراجعة',{exact:true}).click();await page.waitForFunction(()=>window.requests.length===2);
  const calls=await page.evaluate(()=>window.requests);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[0].businessId,'branch');
  if(kind==='AGREEMENT'){assert.deepEqual(calls[0].values.commission.rate,{numerator:750,denominator:10000});assert.equal(calls[0].values.serviceFee.fixed.minorAmount,500000);await fill('commission','8');}else{assert.equal(calls[0].values.campaignVersion,2);assert.equal(calls[0].values.merchantShareFinalRounding.mode,'TOWARD_ZERO');await fill('merchantPercent','0');}
  await page.getByText('حفظ المسودة للمراجعة',{exact:true}).click();await page.waitForFunction(()=>window.requests.length===3);const changed=await page.evaluate(()=>window.requests[2]);assert.notEqual(changed.requestId,calls[0].requestId);
  await page.locator('#commercial-businessId').selectOption('other');assert.equal(await page.locator('form').isVisible(),false);assert.equal(await page.getByText('حفظ المسودة للمراجعة',{exact:true}).count(),0);
  await page.close();
 }
 console.log('Commercial browser: agreement/funding forms, decimal rates, failed writes, stable retries and branch isolation passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
