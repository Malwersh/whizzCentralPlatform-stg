const {test}=require('node:test'),assert=require('node:assert/strict');
const settings=require('../home-promotion-settings'),home=require('../home-layout');
test('header defaults off, validates source, colour, single offer and dates',()=>{
 assert.equal(settings.project(null).enabled,false);
 for(const value of [{source:'unknown'},{backgroundColor:'javascript:bad'},{selection:{source:'merchant',id:'x'},source:'platform'},{intervalSeconds:1},{startAt:'2030-01-02',endAt:'2030-01-01'}])assert.throws(()=>settings.validate(value));
 const v=settings.validate({enabled:true,source:'merchant',selection:{source:'merchant',id:'test'},backgroundColor:'#fdc500'});assert.equal(v.backgroundColor,'#FDC500');assert.equal(v.enabled,true);
});
test('schedule suppresses header outside campaign window',()=>{
 const v={enabled:true,startAt:'2030-01-01',endAt:'2030-02-01'};
 assert.equal(settings.project(v,Date.parse('2029-12-31')).enabled,false);
 assert.equal(settings.project(v,Date.parse('2030-01-10')).enabled,true);
 assert.equal(settings.project(v,Date.parse('2030-02-01')).enabled,false);
});
test('published projection includes configured header but never drafts',()=>{
 const current={draftPromotionHeader:{enabled:true},published:{revision:2,sections:[],promotionHeader:{enabled:false}}};
 assert.equal(home.project(current,{signedIn:false,regionIds:[]}).promotionHeader.enabled,false);
});

test('item colour defaults to automatic and validates manual override',()=>{assert.equal(settings.validate({}).itemBackgroundColor,null);assert.equal(settings.validate({itemBackgroundColor:'#FED64D'}).itemBackgroundColor,'#FED64D');for(const itemBackgroundColor of ['red','#abc',1])assert.throws(()=>settings.validate({itemBackgroundColor}));});
