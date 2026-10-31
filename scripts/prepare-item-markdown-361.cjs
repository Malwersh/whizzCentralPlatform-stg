const fs=require('fs'),path=require('path');
const r=path.resolve(__dirname,'../..');
const parser=require(r+'/whizzCentralPlatform-stg/node_modules/@babel/parser');
const engine=fs.readFileSync(r+'/wizzuser-stg/backend/src/functions/shared/discount-engine.js','utf8');
const contract=fs.readFileSync(r+'/wizzuser-stg/backend/src/functions/shared/discount-contract.js','utf8');
function patch(file,writer=false){
 let s=fs.readFileSync(file,'utf8'),edits=[],counts={engine:0,contract:0,reservation:0};
 const tree=parser.parse(s,{sourceType:'unambiguous'});
 function walk(n){if(!n||typeof n!=='object')return;
  if(n.type==='ObjectMethod'&&n.key?.type==='StringLiteral'){
   const name=n.key.value,exp=n.params[0]?.name,mod=n.params[1]?.name;
   if(name.endsWith('/discount-engine.js')){if(!mod)throw Error('module missing');edits.push([n.body.start+1,n.body.end-1,`\n(function(require,module,exports){${engine}\n})(n=>n==='./discount-contract'?require_discount_contract():require(n),${mod},${exp});\n`]);counts.engine++;return;}
   if(name.endsWith('/discount-contract.js')){if(!mod)throw Error('module missing');edits.push([n.body.start+1,n.body.end-1,`\n(function(module,exports){${contract}\n})(${mod},${exp});\n`]);counts.contract++;return;}
   if(name.endsWith('/shared/discount-reservation.js')){
    let body=s.slice(n.body.start+1,n.body.end-1);
    const rx=/saving = ([a-zA-Z0-9_]+) === eligibleItems.length - 1 \? remaining : Number\(BigInt\(amount\) \* BigInt\(gross\) \/ BigInt\(basis\)\)/g;
    let changed=0;body=body.replace(rx,(match)=>{changed++;const item=/const ([a-zA-Z0-9_]+) = eligibleItems\[/.exec(body)[1];return `saving = d.calculationMode === 'perItem' ? calculateCheckoutDiscountAmount(d,gross,[${item}],0) : `+match.slice('saving = '.length)});
    if(changed!==1)throw Error('allocation mismatch '+file+' '+changed);
    body=body.replace('"applicability",','"calculationMode",\n      "applicability",');
    edits.push([n.body.start+1,n.body.end-1,body]);counts.reservation++;return;
   }
  }
  for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);
 }
 walk(tree);
 if(!counts.engine||!counts.contract)throw Error('missing calculator '+file);
 for(const [a,b,v] of edits.sort((a,b)=>b[0]-a[0]))s=s.slice(0,a)+v+s.slice(b);
 if(writer){
  if(!s.includes('applicability: discountData.applicability'))throw Error('writer field missing');
  s=s.replace('applicability: discountData.applicability',"calculationMode: discountData.calculationMode || 'order',\n      applicability: discountData.applicability");
  const before=s;s=s.replace(/\["perCustomerLimit", "maxDiscountAmount"\]/g,'["perCustomerLimit", "maxDiscountAmount", "calculationMode"]');
  s=s.replace('["title", "description", "type", "value", "applicability",','["title", "description", "type", "value", "calculationMode", "applicability",');
  if(before===s||!s.includes('"value", "calculationMode", "applicability"'))throw Error('writer update mismatch');
 }
 parser.parse(s,{sourceType:'unambiguous'});fs.writeFileSync(file+'.candidate',s);return counts;
}
for(const dir of fs.readdirSync('/tmp/item-markdown-361')){
 const base='/tmp/item-markdown-361/'+dir;
 if(fs.existsSync(base+'/runtime.js'))console.log(dir,'bundle',patch(base+'/runtime.js'));
 if(dir.startsWith('order-receiver'))console.log(dir,'handler',patch(base+'/handler.js',true));
}
