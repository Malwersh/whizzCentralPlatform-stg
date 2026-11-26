const fs=require('fs'),assert=require('assert/strict'),{chromium}=require('playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});try{const p=await b.newPage({viewport:{width:390,height:844}});const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.setContent('<html dir="rtl"><body></body></html>');await p.evaluate(()=>{
window.RBAC={staff:{permissions:['drivers.documents.read','drivers.review']}};window.sent=[];
const data={version:1,initialized:true,activeId:null,profile:{name:'سائق <img src=x onerror=alert(1)>',governorateName:'النجف',workRegionName:'الحيرة'},eligibility:{eligible:false},documents:[{kind:'nationalId',uploaded:true,status:'PENDING_REVIEW',url:'s3://bucket/drivers/d/id'}],vehicles:[{id:'v',type:'car',plateNumber:'123',effectiveStatus:'PENDING_REVIEW',registrationUrl:'s3://bucket/drivers/d/v',review:null}],events:[]};
window.driverStaffApi=async(path,body)=>{if(body){window.sent.push(body);return {...data,version:2};}return data;};window.AWSUtils={resolveDriverDocument:async()=>null};
});await p.addScriptTag({content:fs.readFileSync(require('path').join(__dirname,'../frontend/driver-vehicles.js'),'utf8')});await p.evaluate(()=>window.openDriverVehicleManagement('d'));
assert.equal(await p.locator('dialog').count(),1);assert.equal(await p.locator('dialog img').count(),0);
const form=p.locator('.vehicle-review-form').first();await form.locator('input[type=date]').fill('2027-01-01');await form.locator('textarea').fill('وثيقة مطابقة وواضحة');await form.getByRole('button',{name:'تسجيل قرار المراجعة'}).click();
const sent=await p.evaluate(()=>window.sent);assert.equal(sent.length,1);assert.equal(sent[0].expectedVersion,1);assert.equal(sent[0].documentKind,'nationalId');assert.equal(sent[0].decision,'APPROVED');assert.equal(sent[0].expiryDate,'2027-01-01');assert.equal(sent[0].noExpiry,false);
assert.deepEqual(errors,[]);console.log('PASS management modal, scoped decision payload, expiry capture, version, escaped user input, narrow viewport');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
