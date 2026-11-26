'use strict';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true,args:['--no-sandbox']});try{
 const page=await browser.newPage({viewport:{width:1100,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://app.test/**',r=>r.fulfill({body:'<html></html>',contentType:'text/html'}));await page.goto('https://app.test/pages/orders.html');
 await page.setContent('<html lang="ar" dir="rtl"><body><section id="dispatch-reviews"><button id="dispatch-review-reload">تحديث</button><button id="dispatch-review-more" hidden>المزيد</button><p id="dispatch-review-message"></p><div id="dispatch-review-list"></div></section></body></html>');
 await page.evaluate(()=>{window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://api.test'};window.Auth={ensureSession:async()=>{},getToken:()=> 'token'};window.calls=[];window.stage=0;window.fetch=async(url,options={})=>{
  const item={orderId:'o',source:'SEARCH',caseId:'case',branchName:'مطعم الاختبار',phase:window.stage===2?'SEARCH_RESUMED':'SEARCH_EXHAUSTED',reason:'SEARCH_WINDOW_EXPIRED',goodsState:'BEFORE_PICKUP_RECORDED',holdState:'NOT_RECORDED',active:window.stage!==2,followup:{restartState:window.stage===3?'PENDING':window.stage===4?'NEEDS_REVIEW':null,version:window.stage?1:0,active:window.stage!==2,ownerId:window.stage?'e':null,ownerName:window.stage?'مسؤول التشغيل':null,firstObservedAt:'2026-10-28T18:00:00Z',reviewDueAt:'2026-10-28T18:05:00Z',escalationDueAt:'2026-10-28T18:15:00Z',overdue:true,escalated:true,canClaim:window.stage===0,canRelease:window.stage>0&&window.stage!==2},canRequestRetry:false,canRequestCancel:false};
  if(options.method==='POST'){window.calls.push(JSON.parse(options.body));if(window.calls.length===1)return {ok:false,json:async()=>({error:'UNKNOWN'})};window.stage=1;return {ok:true,json:async()=>({saved:true})};}
  return {ok:true,json:async()=>url.includes('?')?{item}:{items:[item],nextCursor:null}};
 };});
 await page.addStyleTag({path:'frontend/dispatch-followup-340.css'});await page.addScriptTag({path:'frontend/dispatch-followup-ui.js'});await page.addScriptTag({path:'frontend/dispatch-reviews.js'});
 await page.getByText('مسؤول المتابعة: لم يتولّها أحد بعد').waitFor();assert(await page.getByText('متأخر — يحتاج تدخل المشرف').count());
 await page.getByRole('button',{name:'أتولى متابعة الطلب'}).click();await page.getByText('اكتب ملاحظة واضحة من خمسة أحرف على الأقل.').waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0);
 await page.getByRole('textbox',{name:'ملاحظة متابعة تعذر التوزيع'}).fill('التواصل مع المطعم الآن');await page.getByRole('button',{name:'أتولى متابعة الطلب'}).click();await page.getByText('تعذر تأكيد الحفظ. أعد المحاولة بالمحتوى نفسه.').waitFor();
 await page.getByRole('button',{name:'أتولى متابعة الطلب'}).click();await page.getByText('مسؤول المتابعة: مسؤول التشغيل').waitFor();assert(await page.getByRole('button',{name:'حفظ ملاحظة المتابعة'}).count());
 const calls=await page.evaluate(()=>window.calls);assert.equal(calls.length,2);assert.equal(calls[0].requestId,calls[1].requestId);assert.equal(calls[1].baseVersion,0);
 await page.evaluate(()=>{window.stage=3;window.DispatchReviewNavigation.openOrder('o');});await page.getByText('دورة البحث مسجلة — بانتظار تأكيد تشغيل العروض').waitFor();assert(await page.getByRole('button',{name:'حفظ ملاحظة المتابعة'}).count());
 await page.evaluate(()=>{window.stage=4;window.DispatchReviewNavigation.openOrder('o');});await page.getByText('تعذر بدء دورة البحث — يلزم تدخل الإدارة').waitFor();
 await page.evaluate(()=>{window.stage=2;window.DispatchReviewNavigation.openOrder('o');});await page.getByText('أُعيد الطلب إلى البحث عن سائق').waitFor();assert.equal(await page.getByRole('button',{name:'أتولى متابعة الطلب'}).count(),0);assert.equal(await page.getByRole('button',{name:'حفظ ملاحظة المتابعة'}).count(),0);
 assert.deepEqual(errors,[]);await page.screenshot({path:'/private/tmp/dispatch-followup-340/review-browser.png'});console.log(JSON.stringify({status:'PASS',cases:8,claimRetryIdempotency:true,resumedSource:true,noBrowserErrors:true}));
}finally{await browser.close();}})();
