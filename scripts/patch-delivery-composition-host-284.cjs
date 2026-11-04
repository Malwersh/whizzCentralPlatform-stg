'use strict';
// Narrow, offline overlays over pinned live hosts. Old money paths remain byte-for-byte.
const ts=require('../backend/wallet-service/node_modules/typescript');

function patch(source,runtime){
 const parsed=ts.createSourceFile('host.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(parsed.parseDiagnostics.length)throw Error('INVALID_HOST_JAVASCRIPT');
 const all=[],seen=new Set(),edits=[],proofs=[];function visit(n){if(ts.isFunctionDeclaration(n)&&n.name){const key=n.parent.pos+':'+n.name.text;if(seen.has(key))throw Error('DUPLICATE_COMPOSITION_DECLARATION');seen.add(key);all.push([n.name.text,{start:n.getStart(parsed),end:n.end,text:n.getText(parsed)}]);}ts.forEachChild(n,visit);}visit(parsed);
 for(const [name,node] of all){
  const kind=name.replace(/\d+$/,'');
  if(!['allocateDeliveryFundedOrder','createStagingDeliveryCampaignBudget','createStagingDeliveryPromotionSelection','createStagingCommercialSource'].includes(kind))continue;
  if(node.duplicates)throw Error('DUPLICATE_COMPOSITION_FACTORY:'+name);
  if(node.text.includes('delivery-composition-284'))continue;
  const ast=ts.createSourceFile('factory.js',node.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),fn=ast.statements.find(ts.isFunctionDeclaration);
  if(!fn?.body||fn.parameters.length!==1||!ts.isIdentifier(fn.parameters[0].name))throw Error('COMPOSITION_SIGNATURE_CHANGED:'+name);
  const arg=fn.parameters[0].name.text,ref=`require(${JSON.stringify(runtime)})`,marker='/* delivery-composition-284 */';
  let replacement;
  if(kind==='allocateDeliveryFundedOrder'){
   const at=fn.body.getStart(ast)+1;
   replacement=node.text.slice(0,at)+`\n${marker} if(${arg}?.deliveryFunding?.allocation?.schemaVersion===3)return ${ref}.allocateDeliveryFundedOrder(${arg});\n`+node.text.slice(at);
  }else if(kind==='createStagingDeliveryCampaignBudget'){
   const methods=[];function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='settle')methods.push(n);ts.forEachChild(n,visit);}visit(fn.body);
   // Compatibility forwarders have no own planner and keep delegating to their patched target.
   if(!methods.length&&node.text.length<600)continue;
   if(methods.length!==1||methods[0].parameters.length!==1||!ts.isIdentifier(methods[0].parameters[0].name))throw Error('COMPOSITION_SETTLE_CHANGED:'+name);
   const value=methods[0].parameters[0].name.text,at=methods[0].body.getStart(ast)+1;
   replacement=node.text.slice(0,at)+`\n${marker} if(${value}?.expectedFunding?.allocation?.schemaVersion===3)return ${ref}.createStagingDeliveryCampaignBudget(${arg}).settle(${value});\n`+node.text.slice(at);
  }else{
   replacement=node.text.slice(0,fn.body.getStart(ast))+`{${marker}return ${ref}.${kind}(${arg});}`;
  }
  if(ts.createSourceFile('patched.js',replacement,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length)throw Error('COMPOSITION_PATCH_SYNTAX');
  edits.push({...node,replacement});proofs.push({factory:name,mode:kind==='allocateDeliveryFundedOrder'||kind==='createStagingDeliveryCampaignBudget'?'NEW_COMPOSED_CONTRACT_ONLY':'CANONICAL_AGREEMENT_FIRST_SELECTION'});
 }
 let output=source;for(const e of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,e.start)+e.replacement+output.slice(e.end);
 return {source:output,proofs};
}
module.exports={patch};
