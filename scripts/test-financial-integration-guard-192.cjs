const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
for(const name of ['index.js','finance-rollout.js']){
 const source=fs.readFileSync('/private/tmp/financial-retry-192/integration-'+name,'utf8'),ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let text;
 function visit(n){if(ts.isFunctionDeclaration(n)&&n.name?.text==='checkDrivers')text=n.getText(ast);ts.forEachChild(n,visit);}visit(ast);assert(text);
 const guard=vm.runInNewContext('('+text+')',{selection:()=>({order:{branchId:'branch'}}),driver:(oid,d,s)=>{assert.equal(oid,'order');assert.equal(d,'driver');if(s!==undefined)assert.equal(s,'subject');},fail:()=>{throw Error('OUT_OF_SCOPE');}});
 const row={driverId:'driver',financialOffer:{schemaVersion:2,baseOffer:{schemaVersion:1,orderId:'order',branchId:'branch',driverId:'driver',driverSubjectId:'subject'}}};guard('order',row);
 for(const change of [r=>r.financialOffer.baseOffer.driverId='foreign',r=>r.financialOffer.baseOffer.driverSubjectId='foreign',r=>r.financialOffer.baseOffer.orderId='foreign',r=>r.financialOffer.baseOffer.branchId='foreign',r=>delete r.financialOffer.baseOffer.driverSubjectId,r=>r.financialOffer.schemaVersion=3]){const bad=structuredClone(row);change(bad);assert.throws(()=>guard('order',bad));}
}
console.log('Both packaged integration predicates accept scoped V2 and reject six foreign/malformed identities.');
