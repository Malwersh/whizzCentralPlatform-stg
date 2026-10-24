'use strict';
// V2 identity guard only. Preserve every integration/ledger/lifecycle function.
const fs=require('node:fs'),cp=require('node:child_process'),ts=require('../backend/wallet-service/node_modules/typescript');
const dir='/private/tmp/financial-retry-192';const sources=JSON.parse(cp.execFileSync('python3',['-c',"import zipfile,json;z=zipfile.ZipFile('/private/tmp/financial-retry-192/staging-cod-integration.zip');print(json.dumps({n:z.read(n).decode() for n in ['index.js','finance-rollout.js']}))"],{encoding:'utf8',maxBuffer:20000000}));
for(const [name,source]of Object.entries(sources)){
 const ast=ts.createSourceFile(name,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[];
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='checkDrivers'){
  const [oid,row]=node.parameters.map(p=>p.name.getText(ast));if(!node.body.getText(ast).includes('const branch = selection('+oid+').order.branchId'))throw Error('BINDING_CHANGED');
  for(const child of node.body.statements)if(ts.isIfStatement(child)&&child.expression.getText(ast)===row+'.financialOffer'){
   if(!child.thenStatement.getText(ast).includes('driver('+oid+', '+row+'.financialOffer.driverId, '+row+'.financialOffer.driverSubjectId)'))throw Error('GUARD_CHANGED');
   const body=`if (${row}.financialOffer) { const envelope=${row}.financialOffer, offer=envelope.schemaVersion===2?envelope.baseOffer:envelope; const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:#-]{0,149}$/.test(v); if(![1,2].includes(envelope.schemaVersion)||!offer||offer.schemaVersion!==1||!validId(offer.driverId)||!validId(offer.driverSubjectId)||offer.orderId!==${oid}||offer.branchId!==branch||${row}.driverId!=null&&${row}.driverId!==offer.driverId)fail(); driver(${oid},offer.driverId,offer.driverSubjectId); }`;
   edits.push({start:child.getStart(ast),end:child.end,body});
  }
 }ts.forEachChild(node,visit);}visit(ast);if(edits.length!==1)throw Error('EXACT_GUARD_REQUIRED:'+name);let updated=source;for(const edit of edits.sort((a,b)=>b.start-a.start))updated=updated.slice(0,edit.start)+edit.body+updated.slice(edit.end);const out=dir+'/integration-'+name;fs.writeFileSync(out,updated);cp.execFileSync(process.execPath,['--check',out]);
}
console.log('Prepared exactly one V2 identity predicate in each integration guard copy.');
