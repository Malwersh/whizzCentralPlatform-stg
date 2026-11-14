const {test}=require('node:test'),assert=require('node:assert/strict');
const nav=require('../home-navigation'),{validateCatalog}=require('../home-discovery');
test('canonical onboarding activity references reject invented types while preserving old published selectors',()=>{
 const types=[{id:'RESTAURANT'}];nav.references({items:[{kind:'activity',value:'RESTAURANT'}]},null,types);
 nav.references({items:[{kind:'activity',value:'restaurant'}]},null,types);
 assert.throws(()=>nav.references({items:[{kind:'activity',value:'INVENTED'}]},null,types));
 assert.throws(()=>nav.references({items:[{kind:'cuisine',value:'pizza',parentActivities:['INVENTED']}]},{cuisines:[{id:'pizza'}]},types));
});
test('branch, product and menu category mappings remain distinct and validate classification IDs',()=>{
 const c={cuisines:[{id:'pizza',label:'بيتزا',activityIds:['RESTAURANT']}],brands:[],profiles:{branch:{cuisineIds:[],productCuisineIds:{product:['pizza']},categoryCuisineIds:{category:['pizza']}}}};
 const result=validateCatalog(c);assert.deepEqual(result.profiles.branch.cuisineIds,[]);assert.deepEqual(result.profiles.branch.productCuisineIds,{product:['pizza']});
 assert.throws(()=>validateCatalog({...c,profiles:{branch:{cuisineIds:[],productCuisineIds:{product:['unknown']}}}}));
 assert.throws(()=>validateCatalog({...c,cuisines:[{id:'pizza',label:'بيتزا',activityIds:['restaurant']}]}));
});
