'use strict';
const fs=require('node:fs');
function patch(source){
 const read='return detach((await db.send(new import_lib_dynamodb.GetCommand({ TableName, Key, ConsistentRead: true }))).Item ?? null);';
 if(source.split(read).length!==2)throw Error('UNEXPECTED_FINANCIAL_READ_HELPER');
 source=source.replace(read,read.replace('return detach(', 'return structuredClone('));
 const guard=/values\[":v" \+ (i4|i)\] = detach\(saved\[field\]\);/g;
 const matches=[...source.matchAll(guard)];if(matches.length!==1)throw Error('UNEXPECTED_FINANCIAL_GUARD_HELPER');
 source=source.replace(guard,'values[":v" + $1] = structuredClone(saved[field]);');
 const token='ClientRequestToken: quoteHash(operations).slice(0, 36)';
 if(source.split(token).length!==2)throw Error('UNEXPECTED_COMPLETION_TRANSACTION');
 source=source.replace(token,'ClientRequestToken: financialTransactionToken(operations)');
 source+=`\nfunction financialTransactionToken(value) {
 function typed(v) {
  if(v instanceof Set)return ['SET',[...v].map(typed).sort((a,b)=>quoteCanonical(a).localeCompare(quoteCanonical(b)))];
  if(Array.isArray(v))return ['LIST',v.map(typed)];
  if(v&&typeof v==='object')return ['MAP',Object.keys(v).sort().map(k=>[k,typed(v[k])])];
  return ['VALUE',v];
 }
 return quoteHash(typed(value)).slice(0,36);
}\n`;
 return source;
}
module.exports={patch};
if(require.main===module){for(const name of ['index.js','customer-cash-runtime-266.js']){
 const file='/private/tmp/financial-delivery-runtime/'+name;
 fs.writeFileSync(file,patch(fs.readFileSync(file,'utf8')));
}console.log('Prepared actual financial host and cash runtime; no business calls');}
