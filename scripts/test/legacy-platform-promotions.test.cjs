const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {randomUUID}=require('node:crypto');
const source=fs.readFileSync(process.env.PROMOTION_DATA_SERVICE || require('node:path').join(__dirname,'../../frontend/data-service.js'),'utf8');
const legacy={discountId:'MDIS_legacy',campaignId:'obsolete-alias',code:'HGFJG',discountSource:'merchant',title:'Legacy',discountType:'fixed',discountValue:20};
function fixture(){
 const scans=[],writes=[];const token='e30.'+Buffer.from(JSON.stringify({sub:'admin'})).toString('base64url')+'.test';
 const rows=[legacy,{discountId:'campaign',discountSource:'campaign'},{discountId:'untagged'},{discountId:'removed',isDeleted:true},{discountId:'deleted',deletedAt:'2026-01-01'},{discountId:'deleting',deletionRequestId:'request'}];
 const client={scan(p){scans.push(p);return {promise:async()=>p.ExclusiveStartKey?{Items:rows.slice(2)}:{Items:rows.slice(0,2),LastEvaluatedKey:{discountId:'campaign'}}};},get(p){assert.equal(p.TableName,'WizzCentral_Platform_Discounts');return {promise:async()=>({Item:rows.find(x=>x.discountId===p.Key.discountId)})};}};
 const window={AWSUtils:{getDynamoDBClient:async()=>client},Auth:{ensureSession:async()=>{},getToken:()=>token},WIZZCENTRAL_CONFIG:{STAFF_API_BASE_URL:'https://staff.example'}};
 vm.runInNewContext(source,{window,console:{log(){},warn(){},error(){}},crypto:{randomUUID},atob:s=>Buffer.from(s,'base64').toString(),AbortController,setTimeout,clearTimeout,fetch:async(url,options)=>{if(options.method==='GET')return {ok:true,json:async()=>({revision:'current-revision'})};writes.push(JSON.parse(options.body));return {ok:true,json:async()=>({success:true})};}});
 return {service:window.dataService,scans,writes};
}
test('legacy and untagged live offers remain manageable across all pages; deleted records stay hidden',async()=>{const f=fixture();const rows=await f.service.getCampaigns({strict:true});assert.deepEqual(Array.from(rows,x=>x.discountId),['MDIS_legacy','campaign','untagged']);assert.equal(rows[0].id,'MDIS_legacy');assert.equal(rows[0].discountValue,20);assert.equal(f.scans.length,2);assert.ok(f.scans.every(x=>x.TableName==='WizzCentral_Platform_Discounts'&&!x.FilterExpression));});
test('direct lookup supports legacy source tags and excludes deleted records',async()=>{const f=fixture();assert.equal((await f.service.getCampaignById('MDIS_legacy')).code,'HGFJG');assert.equal(await f.service.getCampaignById('deleted'),null);});
test('edit, pause and delete a legacy offer use guarded PLATFORM mutations and the real discount key',async()=>{const f=fixture();await f.service.updateCampaign('MDIS_legacy',{title:'Edited'});await f.service.updateCampaign('MDIS_legacy',{status:'draft',isActive:false});await f.service.deleteCampaign('MDIS_legacy');assert.deepEqual(f.writes.map(x=>x.action),['UPDATE','UPDATE','DELETE']);for(const x of f.writes){assert.equal(x.source,'PLATFORM');assert.equal(x.discountId,'MDIS_legacy');assert.equal(x.baseRevision,'current-revision');assert.equal(x.values?.discountSource,undefined);}});
