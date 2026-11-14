const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),path=require('path');
const parser=require('../node_modules/@babel/parser');
const root='/tmp/item-markdown-361';let count=0;
for(const dir of fs.readdirSync(root))for(const filename of ['runtime.js.candidate','handler.js.candidate']){
 const file=path.join(root,dir,filename);if(!fs.existsSync(file))continue;
 const text=fs.readFileSync(file,'utf8'),tree=parser.parse(text,{sourceType:'unambiguous'}),found={};
 function walk(n){if(!n||typeof n!=='object')return;if(n.type==='ObjectMethod'&&n.key.type==='StringLiteral')for(const key of ['discount-contract','discount-engine'])if(n.key.value.endsWith('/'+key+'.js'))found[key]=n;
 for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 walk(tree);if(filename.startsWith('handler')&&!found['discount-engine'])continue;
 function run(key,env={}){const n=found[key],module={exports:{}};assert.ok(n,key);const context={...env,require,Buffer,process,__name:v=>v};context[n.params[0].name]=module.exports;context[n.params[1].name]=module;vm.runInNewContext(text.slice(n.body.start+1,n.body.end-1),context);return module.exports;}
 const contract=run('discount-contract'),e=run('discount-engine',{require_discount_contract:()=>contract});
 const d=e.normalizeDiscount({discountId:'d',businessId:'b',type:'fixedAmount',value:1000,status:'active',usage_count:0,applicability:'specificItems',applicable_item_ids:['p'],calculationMode:'perItem'});
 assert.equal(e.calculateCheckoutDiscountAmount(d,15000000,[{itemId:'p',price:5000000,quantity:3}],0),3000000);
 assert.equal(e.calculateCheckoutDiscountAmount({...d,calculationMode:'order'},15000000,[{itemId:'p',price:5000000,quantity:3}],0),1000000);
 count++;
}
console.log('PASS actual candidate calculator modules:',count);
const s=fs.readFileSync(root+'/WizzUser-CreateOrder-staging/handler.js.candidate','utf8');assert.ok(s.includes("resolvedDiscount.snapshot && body.action !== 'preview_commercial'"));console.log('PASS commit still requires exact discount; preview derives amount');
