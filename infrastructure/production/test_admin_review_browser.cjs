'use strict';
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=process.env.WIZZ_ADMIN_WEB_BUILD;if(!root)throw Error('WIZZ_ADMIN_WEB_BUILD required');
const server=http.createServer((req,res)=>{const f=path.join(root,req.url.split('?')[0]);if(!fs.existsSync(f)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(f));});
const id='22222222-2222-4222-8222-222222222222';
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({headless:true,channel:'chrome'});let checks=0;try{
 for(const width of [390,1280])for(const enabled of [false,true]){
  const p=await browser.newPage({viewport:{width,height:844}}),errors=[],writes=[];p.on('pageerror',e=>errors.push(e.message));
  await p.route('**/assets/js/auth-utils.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Auth={ensureSession:async()=>{},getToken:()=>"test",clearTokens:()=>{}}'}));
  await p.route('**/staff/drivers',r=>r.fulfill({json:{items:[{driverId:id,name:'محمد',phone:'07800000000',status:'PENDING_REVIEW'}],nextCursor:null}}));
  const data={version:8,initialized:true,profile:{name:'محمد',status:'PENDING_REVIEW',workRegionName:'الحيرة'},capabilities:{review:enabled,suspend:false},documents:[{kind:'nationalId',status:'PENDING_REVIEW',uploaded:true}],vehicles:[],events:[{action:'REVIEW_DOCUMENT',at:'2026-11-16T12:00:00Z',reason:'راجعت الوثيقة'}]};
  await p.route('**/vehicles',async r=>{if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());await new Promise(x=>setTimeout(x,150));return r.fulfill({status:409,json:{error:'STATE_CHANGED'}});}return r.fulfill({json:data});});
  await p.goto('http://127.0.0.1:'+server.address().port+'/pages/drivers.html');await p.getByRole('button',{name:'الوثائق والمركبات',exact:true}).click();await p.getByText('١. وثائق السائق',{exact:true}).waitFor();
  assert.equal(await p.locator('.review-decision').count(),enabled?2:0);checks++;
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  assert.deepEqual(await p.locator('.review-group>h2').allTextContents(),['١. وثائق السائق','٢. المركبات','٣. قرار الحساب']);assert.equal(await p.locator('.review-history[open]').count(),0);checks++;
  await p.screenshot({path:'/private/tmp/wizz-driver-review-workflow-'+width+'-'+enabled+'.png',fullPage:true});
  if(enabled){
   const form=p.locator('.review-document-grid .review-decision').first();await form.locator('summary').click();await form.locator('textarea').fill('راجعت الوثيقة ولا يظهر تاريخ انتهاء');await form.locator('input[type=checkbox]').check();
   await form.getByRole('button',{name:'تسجيل القرار',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.review-document-grid .review-decision [role=alert]')?.textContent.includes('تغيرت بيانات الحساب'));
   assert.equal(writes.length,1);assert.deepEqual(writes[0],{action:'REVIEW_DOCUMENT',documentKind:'nationalId',expectedVersion:8,decision:'APPROVED',reason:'راجعت الوثيقة ولا يظهر تاريخ انتهاء',expiryDate:null,noExpiry:true});checks++;
   assert(await form.locator('button').isDisabled());assert.equal(await p.locator('option[value=SUSPENDED]').count(),0);checks++;
  }
  assert.deepEqual(errors,[]);checks++;await p.close();
 }
 for(const enabled of [false,true]){
  const p=await browser.newPage({viewport:{width:390,height:844}}),writes=[];
  await p.route('**/assets/js/auth-utils.js',r=>r.fulfill({contentType:'application/javascript',body:'window.Auth={ensureSession:async()=>{},getToken:()=>"test",clearTokens:()=>{}}'}));
  await p.route('**/staff/drivers',r=>r.fulfill({json:{items:[{driverId:id,name:'محمد',status:'PENDING_REVIEW'}]}}));
  await p.route('**/vehicles',r=>{if(r.request().method()==='POST'){writes.push(r.request().postDataJSON());return r.fulfill({status:409,json:{error:'STATE_CHANGED'}});}return r.fulfill({json:{version:0,initialized:false,profile:{name:'محمد'},capabilities:{review:enabled},documents:[],vehicles:[]}});});
  await p.goto('http://127.0.0.1:'+server.address().port+'/pages/drivers.html');await p.getByRole('button',{name:'الوثائق والمركبات',exact:true}).click();await p.getByText('١. وثائق السائق',{exact:true}).waitFor();
  assert.equal(await p.getByRole('button',{name:'تهيئة السجل للمراجعة',exact:true}).count(),enabled?1:0);checks++;
  if(enabled){await p.locator('textarea').fill('تهيئة البيانات الموجودة للمراجعة');await p.getByRole('button',{name:'تهيئة السجل للمراجعة',exact:true}).click();await p.getByText('تغيرت بيانات الحساب أو صلاحياتك.',{exact:false}).waitFor();assert.deepEqual(writes,[{action:'INITIALIZE',expectedVersion:0,reason:'تهيئة البيانات الموجودة للمراجعة'}]);assert(await p.getByRole('button',{name:'حدّث الملف قبل إعادة المحاولة',exact:true}).isDisabled());checks++;}
  await p.close();
 }
 console.log(JSON.stringify({reviewBrowserChecksPassed:checks,productionApprovalPerformed:false}));
}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1});
