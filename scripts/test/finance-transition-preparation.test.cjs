'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {noticePatch,prepare}=require('../prepare-finance-transition-52.cjs');
const before=`const unchanged='preserve';
async function codNoticeAllowed(client,item){return true;}
function createWorker(){
 if(!await codNoticeAllowed(client,item))suppressed=true;
 if(!await codNoticeAllowed(client,item)){suppressed=true;break;}
 await sender.send({data:'old'});
}
module.exports={createWorker};`;
const after=before.replace('codNoticeAllowed(client,item){return true;}','codNoticeAllowed(client,item,at){return at>0;}').replaceAll('codNoticeAllowed(client,item))','codNoticeAllowed(client,item,clock()))').replace("data:'old'","data:'new'");
test('notification overlay changes only the reviewed guard, two call sites and send payload',()=>{
 assert.equal(noticePatch(before,after),after);assert.throws(()=>noticePatch(before,after.replace("unchanged='preserve'","unchanged='unexpected'")),/UNREVIEWED_NOTIFICATION_DELTA/);
});
test('drift or duplicate call-site anchors stop candidate generation',()=>{
 assert.throws(()=>noticePatch(before.replace('))suppressed=true;', '))other=true;'),after),/LIVE_SOURCE_ANCHOR_CHANGED/);
 assert.throws(()=>noticePatch(before+'\n if(!await codNoticeAllowed(client,item))suppressed=true;',after),/LIVE_SOURCE_ANCHOR_CHANGED/);
});
test('candidate builder refuses another function before creating output or loading AWS code',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'finance52-boundary-'));try{
 fs.writeFileSync(path.join(temp,'inventory.json'),JSON.stringify([{name:'foreign'},{name:'WizzUser-CreateOrder-staging'}]));
 const out=path.join(temp,'candidate');assert.throws(()=>prepare(temp,out),/EXACT_TWO_FUNCTION_INVENTORY_REQUIRED/);assert.equal(fs.existsSync(out),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
