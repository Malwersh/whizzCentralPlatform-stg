const fs=require('node:fs'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage({viewport:{width:390,height:844}}),writes=[];
 const item={orderId:'order1',orderNumber:'ORD1792545370610',branchName:'مطعم الاختبار',caseId:'case1',caseKey:'CUSTOMER_CASH_REVIEW',version:3,status:'REVIEW_REQUIRED',customerCash:{reports:[{reportId:'customer-report',actorKind:'CUSTOMER',reportedPaidIqd:8000,reason:'<img src=x onerror=alert(1)>',createdAt:'2026-10-21T18:00:00.000Z'},{reportId:'driver-report',actorKind:'DRIVER',reportedPaidIqd:8000,reason:'دفع الزبون المبلغ المدون',createdAt:'2026-10-21T18:00:00.000Z'}],collectionVerification:{collectedIqd:8000},refunds:[{refundId:'refund1',amountIqd:1000,voucherNumber:'CRV-20261021-ABCD',status:'EXECUTED',source:{kind:'COMPANY_CASHBOX',code:'CASH-NJF-01'}}]}};
 await page.route('https://cash.test/**',async route=>{
  const req=route.request();if(req.url().includes('/staff/')){
   if(req.method()==='POST'){writes.push(req.postDataJSON());return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'CASH_REVIEW_CONFLICT'})});}
   return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({item,cashPermissions:{operate:true,approve:true,execute:true}})});
  }
  return route.fulfill({status:200,contentType:'text/html',body:'<html></html>'});
 });
 await page.goto('https://cash.test/pages/customer-cash-review.html?orderId=order1');
 await page.setContent(fs.readFileSync('frontend/pages/customer-cash-review.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
 await page.evaluate(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'original-token'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://cash.test'};});
 await page.addScriptTag({content:fs.readFileSync('frontend/customer-cash-review.js','utf8')});
 await page.getByRole('heading',{name:'إفادات الدفع'}).waitFor();
 assert.equal(await page.locator('#case img').count(),0);assert.equal(await page.locator('#case').innerText().then(s=>s.includes('<img src=x')),true);
 const verification=page.locator('section').filter({has:page.getByRole('heading',{name:'مطابقة إفادتي التحصيل',exact:true})}).first();
 await verification.getByLabel('تعليل الإجراء').fill('مطابقة مستقلة لإفادتي الدفع');
 await verification.getByRole('combobox').nth(0).selectOption('customer-report');await verification.getByRole('combobox').nth(1).selectOption('driver-report');
 await verification.getByRole('button',{name:'مطابقة إفادتي التحصيل',exact:true}).click();await page.getByText('تغيرت المراجعة؛ حدّث الحالة قبل إعادة المحاولة.').waitFor();
 await verification.getByRole('button',{name:'مطابقة إفادتي التحصيل',exact:true}).click();await page.waitForTimeout(100);
 assert.equal(writes.length,2);assert.equal(writes[0].idempotencyKey,writes[1].idempotencyKey);assert.equal(writes[0].customerReportId,'customer-report');
 assert.equal('actorId'in writes[0],false);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 const ids=await page.locator('[id]').evaluateAll(nodes=>nodes.map(n=>n.id));assert.equal(new Set(ids).size,ids.length);
 assert.equal((await page.locator('#case').innerText()).includes('undefined'),false);
 console.log('PASS cash review browser: scoped actions, stable retry keys, escaped evidence text and mobile layout.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
