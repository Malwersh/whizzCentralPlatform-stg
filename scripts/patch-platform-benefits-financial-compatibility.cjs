'use strict';
// Offline only. Delegate new gift contracts, leaving all existing financial paths intact.
const ts=require('../backend/wallet-service/node_modules/typescript');
const {nodes}=require('./prepare-dispatch-coordinated-release.cjs');
function patch(source,runtime){
 const edits=[],proofs=[];
 for(const [name,node] of Object.entries(nodes(source))){
  if(!/^(allocateDeliveryFundedOrder|verifyGoodsPromotionExposure)\d*$/.test(name))continue;
  if(node.duplicates)throw Error('DUPLICATE_COMPATIBILITY_TARGET:'+name);
  if(node.text.includes('platformBenefitFinancialCompatibility'))continue;
  const ast=ts.createSourceFile('factory.js',node.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(ts.isFunctionDeclaration);
  if(!fn?.body||fn.parameters.length!==(name.startsWith('allocate')?1:2)||fn.parameters.some(p=>!ts.isIdentifier(p.name)))throw Error('COMPATIBILITY_SIGNATURE_CHANGED:'+name);
  const args=fn.parameters.map(p=>p.name.text),value=args[0];
  const condition=name.startsWith('allocate')?`typeof ${value}?.deliveryFunding?.policyPin?.policyId==='string'&&${value}.deliveryFunding.policyPin.policyId.startsWith('PLATFORM_BENEFIT#')`:`${value}?.schemaVersion===2&&${value}?.kind==='GOODS_BENEFIT_EXPOSURE'`;
  const method=name.startsWith('allocate')?'allocateDeliveryFundedOrder':'verifyGoodsPromotionExposure';
  const at=fn.body.getStart(ast)+1,insert=`\n// platformBenefitFinancialCompatibility\nif(${condition})return require(${JSON.stringify(runtime)}).${method}(${args.join(',')});\n`;
  edits.push({...node,replacement:node.text.slice(0,at)+insert+node.text.slice(at)});proofs.push({factory:name,contract:method});
 }
 let result=source;for(const e of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,e.start)+e.replacement+result.slice(e.end);
 if(ts.createSourceFile('patched.js',result,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length)throw Error('INVALID_COMPATIBILITY_PATCH');
 return {source:result,proofs};
}
module.exports={patch};
