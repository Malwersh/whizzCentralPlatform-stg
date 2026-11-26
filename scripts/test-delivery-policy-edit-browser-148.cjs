'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'delivery-edit-148-'));
const management=fs.readFileSync(path.join(root,'frontend/delivery-policy-management.js'),'utf8'),builder=fs.readFileSync(path.join(root,'frontend/delivery-policy-form.js'),'utf8');
const script=`
const code=${JSON.stringify(management)},money=n=>({moneySchemaVersion:1,currency:'IQD',scale:1000,minorAmount:n*1000});
const policy={schemaVersion:1,id:'existing',version:1,merchantId:'merchant',branchId:'branch',origin:'PLATFORM',effectiveFrom:'2026-10-20T12:00:00.000Z',effectiveTo:'2026-10-25T12:00:00.000Z',customerRule:{kind:'CAPPED_PRICE',amount:money(1500)},funding:{kind:'PLATFORM'},eligibility:{regionIds:['zone'],maximumRoadMeters:5000,minimumGoods:money(0),minimumGoodsBasis:'AFTER_GOODS_DISCOUNTS',audience:'ALL',goodsDiscountStacking:'ALLOW'},limits:{merchantPerOrder:money(0),platformPerOrder:money(4000),merchantBudget:money(0),platformBudget:money(100000),perCustomerUses:2},onUnavailable:'NORMAL_TARIFF'};
const item={draft:{kind:'DELIVERY',id:'existing',version:2,baseVersion:0,publishedVersion:1,values:policy},current:{version:1},ownerAccepted:true};
const wait=async fn=>{for(let i=0;i<30;i++){if(fn())return;await new Promise(r=>setTimeout(r,40));}throw Error('TIMEOUT');};const check=(v,m)=>{if(!v)throw Error(m);};
async function setup(writable){document.querySelector('main').replaceChildren();const root=document.createElement('details');root.open=true;root.dataset.deliveryPolicies='';document.querySelector('main').append(root);window.sent=[];
 window.commercialMerchantSource={status:'READY',items:[{businessId:'branch',businessName:'مطعم اختبار'},{businessId:'other',businessName:'فرع آخر'}]};
 window.fetch=async(url,options)=>{if(options.method==='POST'){sent.push(JSON.parse(options.body));return {ok:false,status:409,json:async()=>({code:'VERSION_OR_STATE_CONFLICT'})};}return {ok:true,json:async()=>url.includes('delivery-options')?{regions:[{id:'zone',label:'بغداد — المركز — المنطقة'}]}:{businessId:'branch',merchantId:'merchant',items:[item],can:{deliveryEnabled:true,deliveryRequest:writable}}};};
 (0,eval)(code);const branch=root.querySelector('select');branch.value='branch';branch.dispatchEvent(new Event('change'));root.querySelector('button').click();await wait(()=>root.querySelector('article'));return {root,branch};}
(async()=>{try{
 const {root,branch}=await setup(true);[...root.querySelectorAll('button')].find(b=>b.textContent.includes('تعديل وإرسال')).click();await wait(()=>root.querySelector('form [name=amount]'));const form=root.querySelector('form');form.elements.namedItem('amount').value='1000';form.elements.namedItem('reason').value='تحديث عرض التوصيل';form.requestSubmit();await wait(()=>sent.length===1&&root.querySelector('[role=status]').textContent.includes('تغيرت نسخة'));
 check(sent[0].id==='existing'&&sent[0].baseVersion===1&&sent[0].draftVersion===2&&sent[0].values.version===2,'WRONG_EDIT_VERSION');check(policy.customerRule.amount.minorAmount===1500000&&item.current.version===1,'ACTIVE_CHANGED');check(sent.length===1,'AUTO_RETRY_AFTER_CONFLICT');
 branch.value='other';branch.dispatchEvent(new Event('change'));check(form.hidden,'STALE_FORM_VISIBLE');check(sent.length===1,'OLD_BRANCH_SENT');
 const read=await setup(false);check(![...read.root.querySelectorAll('button')].some(b=>b.textContent.includes('تعديل')||b.textContent.includes('إعداد عرض')),'READ_ONLY_EDITABLE');check(sent.length===0,'READ_ONLY_WRITE');
 document.body.dataset.testResult='PASS';
 }catch(e){document.body.dataset.testResult='FAIL';document.body.dataset.error=e.message;}})();`;
const html='<html><meta charset="utf-8"><main></main><script>window.Auth={ensureSession:async()=>{},getToken:()=>"synthetic"};window.WIZZCENTRAL_CONFIG={STAFF_API_BASE_URL:"https://local.invalid"};</script><script>'+builder.replaceAll('</script','<\\/script')+'</script><script>'+script.replaceAll('</script','<\\/script')+'</script></html>';
const file=path.join(dir,'test.html');fs.writeFileSync(file,html);
const result=spawnSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--disable-sync','--window-size=390,844','--user-data-dir='+path.join(dir,'profile'),'--virtual-time-budget=6000','--dump-dom','file://'+file],{encoding:'utf8',timeout:20000,maxBuffer:2000000});
assert.equal(result.status,0);fs.writeFileSync(path.join(dir,'result.html'),result.stdout);assert.ok(/data-test-result="PASS"/.test(result.stdout),'UI failed: '+(result.stdout.match(/data-error="([^"]+)/)?.[1]||'no completion'));
console.log('PASS: published edit version, stale-version refusal, branch invalidation and read-only role');
