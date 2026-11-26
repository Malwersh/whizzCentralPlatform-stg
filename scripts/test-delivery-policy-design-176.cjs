'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-policy-176-'));
const scripts=['delivery-policy-form.js','delivery-policy-management.js'].map(n=>fs.readFileSync(path.join(root,'frontend',n),'utf8')).join('\n');
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><details open data-delivery-policies dir="rtl"><summary>عروض التوصيل</summary></details><script>
window.commercialMerchantSource={status:'READY',items:[{businessId:'branch',businessName:'مطعم اختبار'}]};
window.Auth={ensureSession:async()=>{},getToken:()=> 'synthetic'};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:'https://local.invalid'};
window.sent=[];window.fetch=async(url,options)=>{if(options.method==='POST'){sent.push(JSON.parse(options.body));return {ok:sent.length>1,status:sent.length===1?503:200,json:async()=>({saved:true})};}return {ok:true,json:async()=>url.includes('delivery-options')?{regions:[{id:'zone',label:'بغداد — المركز — المنطقة'}]}:{businessId:'branch',merchantId:'merchant',items:[],can:{deliveryEnabled:true,deliveryRequest:true}}};};
</script><script>${scripts.replaceAll('</script','<\\/script')}</script><script>
(async()=>{const wait=async(fn)=>{for(let i=0;i<30;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('UI_TIMEOUT');};
const check=(v,m)=>{if(!v)throw Error(m);};
try{const root=document.querySelector('details'),branch=root.querySelector('select');branch.value='branch';branch.dispatchEvent(new Event('change'));root.querySelector('button').click();
await wait(()=>[...root.querySelectorAll('button')].some(b=>b.textContent.includes('إعداد عرض')));
[...root.querySelectorAll('button')].find(b=>b.textContent.includes('إعداد عرض')).click();
await wait(()=>root.querySelector('form [name=rule]'));
const form=root.querySelector('form'),set=(n,v)=>{form.elements.namedItem(n).value=v;};
const visible=n=>getComputedStyle(form.elements.namedItem(n).parentElement).display!=='none';
check(!visible('amount')&&!visible('percent')&&!visible('merchantPercent'),'FREE_FIELDS_VISIBLE');
for(const [rule,amount,percent]of [['CAPPED_PRICE',true,false],['AMOUNT_OFF',true,false],['PERCENT_OFF',false,true],['FREE',false,false]]){set('rule',rule);form.elements.namedItem('rule').dispatchEvent(new Event('change'));check(visible('amount')===amount&&visible('percent')===percent&&visible('maximumDiscount')===percent,'WRONG_PRICE_FIELDS');}
for(const [fund,share,contribution]of [['SHARED',true,false],['MERCHANT_THEN_PLATFORM',false,true],['PLATFORM_THEN_MERCHANT',false,true],['MERCHANT',false,false],['PLATFORM',false,false]]){set('funder',fund);form.elements.namedItem('funder').dispatchEvent(new Event('change'));check(visible('merchantPercent')===share&&visible('contribution')===contribution,'WRONG_FUNDING_FIELDS');check(visible('merchantBudget')===(fund!=='PLATFORM'),'WRONG_MERCHANT_BUDGET');check(visible('platformBudget')===(fund!=='MERCHANT'),'WRONG_PLATFORM_BUDGET');}
check(form.querySelectorAll('.offer-section').length===5,'MISSING_SECTIONS');check(document.documentElement.scrollWidth<=innerWidth,'MOBILE_OVERFLOW');
set('merchantBudget','1000');set('merchantPerOrder','100');
set('funder','PLATFORM');form.elements.namedItem('funder').dispatchEvent(new Event('change'));
set('platformPerOrder','4000');set('platformBudget','100000');set('from','2026-10-20T12:00');set('to','2026-10-25T12:00');set('reason','عرض تجربة التوصيل');
form.elements.namedItem('regions').options[0].selected=true;check(form.checkValidity(),'INVALID_FORM');form.requestSubmit();
await wait(()=>sent.length===1&&root.querySelector('[role=status]').textContent.includes('غير متاحة'));form.requestSubmit();
await wait(()=>sent.length===2&&root.querySelector('[role=status]').textContent.includes('أُرسلت'));check(sent[0].requestId===sent[1].requestId,'RETRY_ID_CHANGED');
const body=sent[0];check(body.action==='SAVE_DELIVERY','WRONG_ACTION');check(body.values.origin==='PLATFORM','WRONG_FUNDER');check(body.values.limits.merchantBudget.minorAmount===0&&body.values.limits.merchantPerOrder.minorAmount===0,'HIDDEN_PARTY_NOT_ZERO');check(body.values.customerRule.kind==='FREE','WRONG_PRICE');check(body.values.limits.platformBudget.minorAmount===100000000,'WRONG_MONEY');check(body.values.eligibility.regionIds[0]==='zone','WRONG_REGION');check(![...root.querySelectorAll('button')].some(b=>b.textContent.includes('اعتماد')),'EXTRA_APPROVAL');
document.body.dataset.testResult='PASS';document.body.dataset.action=body.action;
}catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.error=e.message;}})();
</script>`;
const file=path.join(dir,'test.html');fs.writeFileSync(file,html);
const result=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-sync','--window-size=390,844','--user-data-dir='+path.join(dir,'profile'),'--virtual-time-budget=6000','--dump-dom','file://'+file],{encoding:'utf8',timeout:20000,maxBuffer:2000000});
assert.equal(result.status,0,'Chrome failed: '+(result.error?.message||''));
fs.writeFileSync(path.join(dir,'result.html'),result.stdout);
assert.ok(/data-test-result="PASS"/.test(result.stdout),'UI failed: '+(result.stdout.match(/data-error="([^"]+)/)?.[1]||'no completion'));
console.log('PASS: mobile layout, conditional fields, active funder only, canonical payload, retry and two-party workflow');
