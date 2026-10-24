'use strict';
// Add entitlement operations to existing live financial planners. No money code is replaced.
const ts=require('../backend/wallet-service/node_modules/typescript');
const {nodes}=require('./prepare-dispatch-coordinated-release.cjs');
function patch(source,runtime){
 const functions=nodes(source),edits=[],proofs=[];
 const bridge="{send:async command=>({Item:await strongGet(db,command.input.TableName,command.input.Key)})}";
 const moduleRef=`require(${JSON.stringify(runtime)})`;
 for(const [name,node] of Object.entries(functions)){
  if(!/^(prepareCodRelease|prepareFullCashRelease|createStagingCodCompletion|createFullCashCompletion|createStagingDeliveryCampaignBudget)\d*$/.test(name))continue;
  if(node.text.includes('settlePlatformBenefit')||node.text.includes('platform-benefits-lifecycle'))continue;
  if(node.duplicates)throw Error('DUPLICATE_LIFECYCLE_FACTORY:'+name);
  if(!functions.strongGet){if(name.startsWith('createStagingDeliveryCampaignBudget'))continue;throw Error('MISSING_HOST_STRONG_GET');}
  const ast=ts.createSourceFile('factory.js',node.text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),insertions=[];
  const add=(at,text)=>insertions.push({at,text});
  if(/^prepare/.test(name)){
   const returns=[];function visit(n){if(ts.isReturnStatement(n)&&n.expression&&ts.isObjectLiteralExpression(n.expression)&&n.expression.properties.some(p=>p.name?.getText(ast)==='journalLines'))returns.push(n);ts.forEachChild(n,visit);}visit(ast);
   if(returns.length!==1)throw Error('RELEASE_RETURN_CHANGED:'+name);
   const full=name.startsWith('prepareFullCash'),ops=full?'operations':'ops',enabled=full?'terminal':'releasePromotion';
   add(returns[0].getStart(ast),`if(${enabled}&&order.platformBenefitReceipt?.target==='GOODS'){const benefit=await ${moduleRef}.settlePlatformBenefit(${bridge},{orderId:order.orderId,target:'GOODS',outcome:'RELEASED',keepUse:order.status!=='pending'||['confirmedAt','merchantAcceptedAt','acceptedAt','financialAcceptance'].some(k=>order[k]!=null)});if(benefit.replayed)throw Error('BENEFIT_RESERVATION_CONFLICT');${ops}.push(...benefit.operations);}\n`);
  }else if(name.startsWith('createStagingDeliveryCampaignBudget')){
   // Some read-only storefront bundles contain a disabled stub; leave it intact.
   if(node.text.length<1000)continue;
   const methods=[];function visit(n){if(ts.isMethodDeclaration(n)&&n.name.getText(ast)==='settle')methods.push(n);ts.forEachChild(n,visit);}visit(ast);
   if(methods.length!==1)throw Error('DELIVERY_SETTLE_CHANGED');
   const statements=methods[0].body.statements;
   const anchors=[];
   for(const statement of statements){if(!ts.isVariableStatement(statement))continue;for(const d of statement.declarationList.declarations){const a=d.initializer;if(!a||!ts.isAwaitExpression(a)||!ts.isCallExpression(a.expression))continue;const call=a.expression;if(!ts.isIdentifier(call.expression)||!/^get\d*$/.test(call.expression.text)||call.arguments.length!==1)continue;const key=call.arguments[0];if(!ts.isCallExpression(key)||!ts.isIdentifier(key.expression)||!/^holdKey\d*$/.test(key.expression.text)||key.arguments.length!==1)continue;const member=key.arguments[0];if(!ts.isPropertyAccessExpression(member)||member.name.text!=='orderId'||!ts.isIdentifier(member.expression))continue;anchors.push({statement,request:member.expression.text});}}
   if(anchors.length!==1)throw Error('DELIVERY_HOLD_ANCHOR_CHANGED');const firstHold=anchors[0].statement,request=anchors[0].request;
   add(firstHold.getStart(ast),`if(r.expectedFunding?.policyPin?.policyId?.startsWith('PLATFORM_BENEFIT#')){const order=await strongGet(db,'WizzOrders',{PK:'ORDER#'+r.orderId,SK:'META'}),receipt=order?.platformDeliveryBenefitReceipt??order?.platformBenefitReceipt;if(!order||receipt?.target!=='DELIVERY'||'PLATFORM_BENEFIT#'+receipt.campaignId!==r.expectedFunding.policyPin.policyId)throw Error('BENEFIT_RESERVATION_INVALID');return ${moduleRef}.settlePlatformBenefit(${bridge},{orderId:r.orderId,target:'DELIVERY',outcome:r.outcome,keepUse:order.status!=='pending'||['confirmedAt','merchantAcceptedAt','acceptedAt','financialAcceptance'].some(k=>order[k]!=null),expectedFunding:r.expectedFunding});}\n`.replace(/\br\./g,request+'.'));
  }else{
   const arrays=[];function visit(n){if(ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>['ops','operations'].includes(d.name.getText(ast))&&ts.isArrayLiteralExpression(d.initializer)&&d.initializer.getText(ast).includes('exactCheck(')))arrays.push(n);ts.forEachChild(n,visit);}visit(ast);
   if(arrays.length!==1)throw Error('COMPLETION_OPERATIONS_CHANGED:'+name);
   const ops=arrays[0].declarationList.declarations.find(d=>['ops','operations'].includes(d.name.getText(ast))).name.getText(ast);
   add(arrays[0].end,`\nif(order.platformBenefitReceipt?.target==='GOODS'){const benefit=await ${moduleRef}.settlePlatformBenefit(${bridge},{orderId,target:'GOODS',outcome:'CAPTURED'});if(benefit.replayed)throw Error('BENEFIT_RESERVATION_CONFLICT');${ops}.push(...benefit.operations);}\n`);
  }
  let modified=node.text;for(const e of insertions.sort((a,b)=>b.at-a.at))modified=modified.slice(0,e.at)+e.text+modified.slice(e.at);
  if(ts.createSourceFile('modified.js',modified,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).parseDiagnostics.length)throw Error('INVALID_LIFECYCLE_PATCH');
  edits.push({...node,replacement:modified});proofs.push({factory:name,insertions:insertions.length});
 }
 let result=source;for(const e of edits.sort((a,b)=>b.start-a.start))result=result.slice(0,e.start)+e.replacement+result.slice(e.end);
 return {source:result,proofs};
}
module.exports={patch};
