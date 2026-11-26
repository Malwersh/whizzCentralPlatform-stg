'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
(async()=>{
 const base=path.resolve(__dirname,'..'),html=fs.readFileSync(base+'/frontend/pages/merchants.html','utf8');
 const section=html.slice(html.indexOf('<details id="merchant-staff-policy-section"'),html.indexOf('<!-- Auth and Data Status -->',html.indexOf('<details id="merchant-staff-policy-section"')));
 const service=require('../backend/staff-service/merchant-staff-policy');let current=null,posted=[],canManage=true,conflict=false;
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture',logout:async()=>{}};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://fixture.invalid'};});
  await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<meta charset="utf-8">'+section+'<script src="/policy.js"></script>'});if(url.pathname==='/policy.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync(base+'/frontend/merchant-staff-policy.js','utf8')});if(url.pathname.startsWith(service.PATH)){
   if(url.pathname.endsWith('/save')){if(conflict)return route.fulfill({status:409,json:{error:'VERSION_OR_STATE_CONFLICT'}});const body=route.request().postDataJSON();const next=service.validate(body.values,current);posted.push(body);current=next;return route.fulfill({json:{status:'SAVED',current}});}
   if(url.pathname.endsWith('/history'))return route.fulfill({json:{items:[{...current,updatedAt:'2026-10-15T12:00:00Z',reason:'<img src=x onerror=alert(1)>'}],nextCursor:null}});
   return route.fulfill({json:{current,capabilities:service.REGISTRY,rolePresets:require('../backend/staff-service/staff-capabilities').rolePresets(),canManage,initialized:!!current}});
  }return route.abort();});
  await page.goto('http://localhost:9876/');assert.equal(posted.length,0);
  await page.locator('#merchant-staff-policy-section > summary').click();await page.locator('#staff-policy-editor').waitFor({state:'visible'});
  assert.equal(await page.locator('#staff-policy-capabilities input:enabled').count(),0);
  await page.locator('#staff-policy-ar').fill('مدير <b>تجريبي</b>');await page.locator('#staff-policy-en').fill('Custom manager');await page.locator('#staff-policy-reason').fill('إعداد النوع للاختبار');await page.locator('#staff-policy-form button').click();await page.locator('#staff-policy-message').filter({hasText:'حُفظ نوع الموظف'}).waitFor();
  assert.equal(posted[0].baseVersion,0);assert.equal(current.roles[0].version,1);assert.deepEqual(current.enabledPermissions,[]);assert.deepEqual(current.roles[0].permissions,[]);assert.equal(await page.locator('#staff-policy-types b').count(),0);
  await page.locator('#staff-policy-enabled').uncheck();await page.locator('#staff-policy-reason').fill('أرشفة النوع للاختبار');await page.locator('#staff-policy-form button').click();await page.waitForFunction(()=>document.querySelector('#staff-policy-types option')?.textContent.includes('مؤرشف'));
  assert.equal(current.roles[0].version,2);assert.equal(current.roles.length,1);
  for(const id of ['branch.read','orders.read','orders.accept'])await page.locator('#staff-policy-global-capabilities input[value="'+id+'"]').check();await page.locator('#staff-policy-global-reason').fill('إتاحة القدرات المختبرة محليًا');await page.locator('#staff-policy-global-save').click();await page.locator('#staff-policy-message').filter({hasText:'حُفظت إتاحة الصلاحيات'}).waitFor();assert.deepEqual(current.enabledPermissions,['orders.read','orders.accept','branch.read']);
  await page.locator('#staff-policy-history-load').click();await page.locator('#staff-policy-history').filter({hasText:'<img src=x'}).waitFor();assert.equal(await page.locator('#staff-policy-history img').count(),0);
  await page.getByRole('button',{name:'تجهيز قالب مدير',exact:true}).click();assert.equal(await page.locator('#staff-policy-enabled').isDisabled(),false);assert.equal(await page.locator('#staff-policy-enabled').isChecked(),true);assert.equal(await page.locator('#staff-policy-global-capabilities input[value="finance.payout.receive"]').count(),1);
  await page.getByRole('button',{name:'تجهيز قالب موظف تشغيلي',exact:true}).click();assert.equal(await page.locator('#staff-policy-enabled').isDisabled(),false);for(const id of ['orders.accept','orders.reject','orders.prepare','orders.ready'])assert.equal(await page.locator('#staff-policy-capabilities input[value="'+id+'"]').isChecked(),true);await page.locator('#staff-policy-reason').fill('تجهيز حزمة تشغيل الطلبات');await page.locator('#staff-policy-form button').click();await page.locator('#staff-policy-message').filter({hasText:'حُفظ نوع الموظف'}).waitFor();assert.equal(current.roles.find(r=>r.id==='OPERATIONAL_EMPLOYEE').permissions.includes('menu.edit'),false);
  conflict=true;await page.locator('#staff-policy-description').fill('change');await page.locator('#staff-policy-reason').fill('تعارض إصدار الاختبار');await page.locator('#staff-policy-form button').click();await page.locator('#staff-policy-message').filter({hasText:'تغيرت السياسة'}).waitFor();assert.equal(posted.length,4);
  canManage=false;await page.locator('#staff-policy-reload').click();await page.locator('#staff-policy-editor').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
  process.stdout.write(JSON.stringify({add:true,archive:true,blockedCapabilities:true,conflict:true,safeText:true,readOnly:true,centralEnablement:true,realWrites:false})+'\n');
 }finally{await browser.close();}
})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
