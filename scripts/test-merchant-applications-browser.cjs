const {chromium}=require('playwright'),fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
(async()=>{
 const base=path.resolve(__dirname,'..'),html=fs.readFileSync(base+'/frontend/pages/merchants.html','utf8');
 const section=html.slice(html.indexOf('<details id="merchant-agreement-section"'),html.indexOf('<!-- Auth and Data Status -->'));
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),page=await browser.newPage(),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://fixture.invalid'};});
 let agreement={baseVersion:1,version:'v1',textAr:'نص الاتفاقية العامة للاختبار',ready:true,canEdit:true},pending=true;
 await page.route('**/*',async route=>{
  const request=route.request(),url=request.url();
  if(url==='http://localhost:9877/')return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8">'+section+'<script src="/merchant-applications.js"></script>'});
  if(url.endsWith('/merchant-applications.js'))return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(base+'/frontend/merchant-applications.js','utf8')});
  if(url.endsWith('/agreement')){
   if(request.method()==='POST'){const body=request.postDataJSON();writes.push(body);agreement={...agreement,...body,baseVersion:2};return route.fulfill({json:{saved:true}});}
   return route.fulfill({json:agreement});
  }
  if(url.endsWith('/applications'))return route.fulfill({json:{canReview:true,canReadDocuments:false,items:pending?[{queueKey:'q1',draft:{name:'<img src=x onerror=alert(1)>',businessTypeId:'MARKET',address:'عنوان الفرع',regionNames:['العراق','النجف'],contactPhone:'fixture',version:4,submission:{agreement:{version:'v1'}}}}]:[]}});
  if(url.endsWith('/applications/review')){writes.push(request.postDataJSON());pending=false;return route.fulfill({json:{status:'NEEDS_INFORMATION'}});}
  return route.abort();
 });
 await page.goto('http://localhost:9877/');await page.locator('#merchant-agreement-section > summary').click();
 await page.locator('#merchant-agreement-version').fill('v2');await page.locator('#merchant-agreement-text').fill('اتفاقية معدلة للاختبار فقط');await page.locator('#merchant-agreement-reason').fill('تحديث نص الاختبار');await page.locator('#merchant-agreement-form button').click();
 await page.waitForFunction(()=>document.querySelector('#merchant-agreement-version').value==='v2');
 await page.locator('#merchant-applications-section > summary').click();await page.getByRole('heading',{name:'<img src=x onerror=alert(1)>'}).waitFor();assert.equal(await page.locator('#merchant-applications-list img').count(),0);
 await page.getByRole('button',{name:'يحتاج استكمالًا',exact:true}).click();await page.getByText('اكتب سبب القرار من خمسة أحرف على الأقل.').waitFor();assert.equal(writes.length,1);
 await page.locator('#merchant-applications-list textarea').fill('يرجى توضيح العنوان');await page.getByRole('button',{name:'يحتاج استكمالًا',exact:true}).click();await page.getByText('تم حفظ القرار. الفرع المعتمد يحتاج إكمال تجهيزاته قبل التشغيل.').waitFor();
 assert.equal(writes[1].baseVersion,4);assert.equal(writes[1].decision,'NEEDS_INFORMATION');assert.deepEqual(errors,[]);await browser.close();console.log(JSON.stringify({agreementEditable:true,reviewRequiresReason:true,versionForwarded:true,untrustedTextEscaped:true,realWrites:false}));
})().catch(error=>{console.error(error.message);process.exit(1)});
