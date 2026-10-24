'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),assert=require('node:assert/strict');
const service=require('../backend/staff-service/delivery-pricing');
(async()=>{
 const testFinalRounding=process.env.TEST_FINAL_ROUNDING==='true';
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  let draft=null,current=null,posts=[],conflict=false,readOnly=false;
  await page.addInitScript(()=>{window.Auth={ensureSession:async()=>{},getToken:()=> 'fixture',logout:async()=>{}};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'http://fixture.invalid'};});
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:fs.readFileSync('frontend/pages/delivery-pricing.html','utf8').replace(/<script[^>]*src="(?!\.\.\/delivery-pricing.js)[^"]*"[^>]*><\/script>/g,'')});
   if(url.pathname==='/delivery-pricing.js')return route.fulfill({contentType:'application/javascript',body:fs.readFileSync('frontend/delivery-pricing.js','utf8')});
   if(url.pathname.startsWith(service.PATH)){
    const body=route.request().method()==='POST'?route.request().postDataJSON():null;if(body)posts.push({path:url.pathname,body});
    if(url.pathname.endsWith('/draft')){if(conflict)return route.fulfill({status:409,json:{error:'VERSION_OR_STATE_CONFLICT'}});draft={version:(draft?.version||0)+1,baseVersion:body.baseVersion,values:service.values(body.values),reason:body.reason};return route.fulfill({json:{policy:draft,status:'DRAFT_SAVED'}});}
    if(url.pathname.endsWith('/simulate')){const e=require('../backend/staff-service/pricing-runtime/deliveryPricing');const r=draft.values;const base={schemaVersion:1,at:body.at,context:body.context};const published=list=>list.map(x=>({...x,status:'PUBLISHED'}));return route.fulfill({json:{simulation:true,source:'DRAFT',version:draft.version,delivery:e.calculateDeliveryFee({...base,rules:published(r.deliveryRules),deliveryRoute:body.deliveryRoute,discount:null}),driver:e.calculateDriverEarning({...base,rules:published(r.driverRules),pickupRoute:body.pickupRoute,deliveryRoute:body.deliveryRoute})}});}
    if(url.pathname.endsWith('/history'))return route.fulfill({json:{items:[{version:1,updatedAt:'2026-10-15',reason:'<img src=x onerror=alert(1)>'}],nextCursor:null}});
    return route.fulfill({json:{current,draft,can:{request:!readOnly,approve:false,simulate:true}}});
   }return route.abort();
  });
  await page.goto('http://fixture.invalid/');await page.locator('#pricing-content').waitFor({state:'visible'});
  for(const kind of ['delivery','driver']){
   await page.locator('#pricing-add-'+kind).click();
   const common={id:kind,version:'1',scopeId:'GLOBAL',priority:'1',from:'2026-10-01T00:00:00.000Z',base:'1000',minimum:'0',maximum:'20000',longAfter:'10000',longFlat:'0',longKm:'0'};
   const extra=kind==='delivery'?{perKm:'500',maxMeters:'30000',maxSeconds:'3600',zones:'zone'}:{pickupPerKm:'100',pickupIncludedMeters:'1000',deliveryPerKm:'200',perMinute:'50'};
   for(const [id,value]of Object.entries({...common,...extra}))await page.locator('#rule-'+id).fill(value.endsWith('Z')?value.slice(0,16):value);
   if(testFinalRounding)await page.locator('#rule-finalIncrement').fill('250');
   await page.locator('#pricing-rule-form button[type=submit]').click();
  }
  if(testFinalRounding){await page.locator('#pricing-delivery-list button').first().click();assert.equal(await page.locator('#rule-finalIncrement').inputValue(),'250');await page.locator('#rule-finalIncrement').fill('500');await page.locator('#pricing-rule-form button[type=submit]').click();}
  await page.locator('#pricing-reason').fill('حفظ قواعد المحاكاة');await page.locator('#pricing-save').click();await page.locator('#pricing-message').filter({hasText:'حُفظت المسودة'}).waitFor();assert.equal(draft.values.deliveryRules.length,1);assert.equal(draft.values.driverRules.length,1);assert.equal(posts.length,1);
  for(const [id,value]of Object.entries({branchId:'branch',merchantId:'merchant',zoneId:'zone',cityId:'city',governorateId:'gov',vehicleType:'BIKE',at:'2026-10-15T12:00:00.000Z',pickupMeters:'2000',pickupSeconds:'600',deliveryMeters:testFinalRounding?'3331':'2000',deliverySeconds:'600'}))await page.locator('#sim-'+id).fill(value.endsWith('Z')?value.slice(0,16):value);
  await page.locator('#pricing-simulate').click();await page.locator('#pricing-sim-result').filter({hasText:testFinalRounding?'رسوم الزبون: 2500 IQD':'رسوم الزبون: 2000 IQD'}).waitFor();assert.ok((await page.locator('#pricing-sim-result').textContent()).includes(testFinalRounding?'أجرة السائق: 2750 IQD':'أجرة السائق: 2500 IQD'));assert.equal(posts[1].body.rules,undefined);
  await page.locator('#sim-deliveryMeters').fill('3000');assert.equal(await page.locator('#pricing-sim-result').textContent(),'');
  await page.locator('#pricing-history-load').click();await page.locator('#pricing-history').filter({hasText:'<img src=x'}).waitFor();assert.equal(await page.locator('#pricing-history img').count(),0);
  conflict=true;await page.locator('#pricing-reason').fill('اختبار تعارض الإصدار');await page.locator('#pricing-save').click();await page.locator('#pricing-message').filter({hasText:'تغير الإصدار'}).waitFor();assert.equal(draft.version,1);
  readOnly=true;await page.locator('#pricing-reload').click();await page.locator('#pricing-content').waitFor({state:'visible'});await page.locator('#pricing-edit-actions').waitFor({state:'hidden'});assert.equal(await page.locator('#pricing-delivery-list button').count(),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({draftForms:true,editableFinalRounding:testFinalRounding,sameEngineSimulation:true,staleResultCleared:true,safeText:true,conflict:true,readOnly:true,realWrites:false}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
