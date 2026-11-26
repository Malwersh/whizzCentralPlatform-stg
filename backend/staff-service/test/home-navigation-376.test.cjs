const {test}=require('node:test'),assert=require('node:assert/strict');
const nav=require('../home-navigation'),home=require('../home-layout'),catalogService=require('../home-discovery');
const item=(patch={})=>({id:'pizza-chip',label:'بيتزا',kind:'cuisine',value:'pizza',enabled:true,audience:'all',regionIds:[],icon:'pizza',imageKey:null,startAt:null,endAt:null,...patch});
const all=()=>item({id:'all',label:'الكل',kind:'all',value:null,icon:'grid'});
const strip=(extra={})=>({enabled:true,items:[all(),item()],...extra});
const catalog={pk:'HOME_DISCOVERY',sk:'CATALOG',version:1,cuisines:[{id:'pizza',label:'بيتزا'},{id:'healthy',label:'صحي'}],brands:[{id:'chain',label:'سلسلة'}],profiles:{b:{cuisineIds:['pizza','healthy'],brandId:'chain'}}};
test('navigation is optional for older drafts; bounded typed selectors reject malformed content',()=>{
 assert.equal(nav.validate(null),null);assert.equal(nav.validate(strip()).items[1].value,'pizza');
 for(const config of [strip({items:[]}),strip({items:Array(21).fill(all())}),strip({items:[item()]}),strip({items:[all(),item({id:'all'})]}),strip({items:[all(),item({label:'<script>'})]}),strip({items:[all(),item({kind:'sql'})]}),strip({items:[all(),item({kind:'activity',value:'unknown'})]}),strip({items:[all(),item({imageKey:'private/users/a.png'})]}),strip({items:[all(),item({startAt:'2028-01-01',endAt:'2027-01-01'})]})])assert.throws(()=>nav.validate(config));
});
test('All remains first and available, while strip itself can be disabled',()=>{
 assert.throws(()=>nav.validate(strip({items:[all(),item({id:'second',kind:'all',value:null})]})));
 assert.throws(()=>nav.validate(strip({items:[all(),item()].reverse()})));
 assert.throws(()=>nav.validate(strip({items:[all()&&{...all(),enabled:false}]})));
 assert.deepEqual(nav.project(nav.validate(strip({enabled:false}))).items,[]);
});
test('projection respects audience, region, dates and order without exposing targeting internals',()=>{
 const n=nav.validate(strip({items:[all(),item({regionIds:['r'],audience:'signedIn',startAt:'2026-01-01',endAt:'2027-01-01'}),item({id:'off',enabled:false})]}));
 assert.equal(nav.project(n,{signedIn:false,regionIds:['r'],now:Date.parse('2026-11-02')}).items.length,1);
 const p=nav.project(n,{signedIn:true,regionIds:['r'],now:Date.parse('2026-11-02')});assert.deepEqual(p.items.map(x=>x.id),['all','pizza-chip']);assert.equal(p.items[1].regionIds,undefined);
 assert.equal(nav.project(n,{signedIn:true,regionIds:['elsewhere'],now:Date.parse('2026-11-02')}).items.length,1);
 assert.equal(nav.project(n,{signedIn:true,regionIds:['r'],now:Date.parse('2028-11-02')}).items.length,1);
});
test('classification selectors must exist in authoritative catalog',()=>{
 nav.references(nav.validate(strip()),catalog);assert.throws(()=>nav.references(nav.validate(strip()),{cuisines:[],brands:[]}));
});
test('image URLs are signed from controlled keys and failure leaves icon fallback',async()=>{
 const n=nav.validate(strip({items:[all(),item({imageKey:'home-slideshow/admin/photo.jpg'})]}));let key;
 const p=await nav.decorate(n,{categoryImageUrl:async x=>(key=x,'https://signed.test/image')});assert.equal(key,'home-slideshow/admin/photo.jpg');assert.equal(p.items[1].imageUrl,'https://signed.test/image');
 const fallback=await nav.decorate(n,{categoryImageUrl:async()=>{throw Error('unavailable')}});assert.equal(fallback.items[1].imageUrl,null);
});
function fixture(){let current={...home.KEY,version:0,draft:[],published:null,history:[]};const writes=[];const actor={employeeId:'admin',status:'ACTIVE',version:1,roles:['bootstrap_admin'],scope:{allRegions:true}};
 const ctx={table:'staff',guard:()=>({ConditionCheck:{}}),audit:()=>({Put:{Item:{pk:'AUDIT'}}}),db:{send:async c=>{if(c.constructor.name==='GetCommand'){const key=c.input.Key;return {Item:key.pk==='HOME_LAYOUT'?current:key.pk==='HOME_DISCOVERY'?catalog:key.pk==='CUSTOMER_INTERFACES'?null:{regionId:'r',businessId:'b'}};}writes.push(c.input);const put=c.input.TransactItems.find(t=>t.Put?.Item.pk==='HOME_LAYOUT');if(put)current=put.Put.Item;return {};}}};return {ctx,actor,writes,get current(){return current;}};}
test('strip draft and publishing preserve existing welcome and sections, with optimistic conflict guard',async()=>{
 const f=fixture();await home.route(f.ctx,f.actor,'POST','/staff/home-layout/draft',{baseVersion:0,sections:[],navigation:strip()});assert.equal(home.project(f.current,{signedIn:false,regionIds:[]}).navigation,null);
 await home.route(f.ctx,f.actor,'POST','/staff/home-layout/publish',{baseVersion:1});assert.equal(home.project(f.current,{signedIn:false,regionIds:[]}).navigation.items[1].label,'بيتزا');
 await assert.rejects(home.route(f.ctx,f.actor,'POST','/staff/home-layout/draft',{baseVersion:1,sections:[],navigation:strip()}),e=>e.status===409);
 await home.route(f.ctx,f.actor,'POST','/staff/home-layout/draft',{baseVersion:2,sections:[],welcome:{...home.DEFAULT_COPY,guest:'مرحبًا'}});assert.equal(f.current.draftNavigation.items[1].value,'pizza');
});
test('navigation cannot reference unknown classifications; failure writes nothing',async()=>{const f=fixture();await assert.rejects(home.route(f.ctx,f.actor,'POST','/staff/home-layout/draft',{baseVersion:0,sections:[],navigation:strip({items:[all(),item({value:'unknown'})]})}),/Unknown navigation/);assert.equal(f.writes.length,0);});
test('catalog cannot delete a classification used by draft, publication or rollback history',async()=>{
 const f=fixture();await home.route(f.ctx,f.actor,'POST','/staff/home-layout/draft',{baseVersion:0,sections:[],navigation:strip()});const before=f.writes.length;
 await assert.rejects(catalogService.route(f.ctx,f.actor,'POST',{baseVersion:1,cuisines:[{id:'healthy',label:'صحي'}],brands:catalog.brands,profiles:{}}),/Unknown navigation/);assert.equal(f.writes.length,before);
});
