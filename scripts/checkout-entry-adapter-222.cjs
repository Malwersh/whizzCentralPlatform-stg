'use strict';
const ts=require('../backend/wallet-service/node_modules/typescript');
function adapt(source){
 const ast=ts.createSourceFile('index.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),edits=[],seen=new Set();
 const runtime='require("../../checkout-finance-runtime-222.js")';
 function change(text,from,to){if(text.split(from).length!==2)throw Error('EXACT_ANCHOR_REQUIRED:'+from.slice(0,90));return text.replace(from,to);}
 function visit(n){
  if(ts.isFunctionDeclaration(n)&&n.name&&['createFinanceRollout2','createStagingQuoteOrder2','createStagingDeliveryPromotionSelection2'].includes(n.name.text)){
   const name=n.name.text,key=name.replace(/2$/,'');if(seen.has(name))throw Error('DUPLICATE_FACTORY');seen.add(name);
   edits.push({start:n.getStart(ast),end:n.end,text:`function ${name}(options) { return ${runtime}.${key}({...options${key==='createStagingQuoteOrder'?',enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==="FULL_CASH_AT_DELIVERY_V1"':key==='createStagingDeliveryPromotionSelection'?',lifecycleReadMode:"CONDITION_CHECK"':''}}); }`});return;
  }
  if(ts.isFunctionDeclaration(n)&&n.name?.text==='createStagingCommercialSource2'){
   let s=n.getText(ast);seen.add(n.name.text);
   s=change(s,'const { db } = options, now = options.now ?? Date.now;',`const { db } = options, now = options.now ?? Date.now;\n const canonicalFinance=${runtime};\n const fullCash=process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1';`);
   s=change(s,'const terms = record.terms;','let terms = record.terms;');
   s=change(s,'deliveryFunding = copy(promotion.deliveryFunding);','if(promotion.agreement===true)terms={...terms,commission:copy(promotion.commission)};\n deliveryFunding = copy(promotion.deliveryFunding);');
   s=change(s,'(0, deliveryFundedAllocation_1.allocateDeliveryFundedOrder)({','canonicalFinance.allocateDeliveryFundedOrder({');
   s=change(s,'const deliveryAmount = deliveryFunding?.allocation.platformShare',"canonicalFinance.assertMinimumOrder(promotion?.agreement===true?{minimum_order:promotion.minimumOrderAmountIqd}:branch,goods.goodsGross.minorAmount);\n const deliveryAmount = deliveryFunding?.allocation.platformShare");
   s=change(s,'const funding = { amount: calculation.platformGoodsDiscountFundingRequired, policy: fundingPolicy, holdId: amountMinor ? "PROMO#" + orderId : null };',`const goodsExposure=fullCash&&amountMinor?canonicalFinance.prepareGoodsPromotionExposure(r4.discount?.campaign,r4.discount?.snapshot.source,calculation.platformGoodsDiscountFundingRequired):null;\n const funding = {...(fullCash?{exposure:goodsExposure}:{}),amount: calculation.platformGoodsDiscountFundingRequired, policy: fundingPolicy, holdId:fullCash?null:amountMinor ? "PROMO#" + orderId : null };`);
   s=change(s,'if (amountMinor || deliveryAmount.minorAmount) {','if (!fullCash && (amountMinor || deliveryAmount.minorAmount)) {');
   s=change(s,'const financialSnapshot = deliveryFunding ?', 'const financialSnapshot = fullCash?canonicalFinance.prepareFullCashOrderSnapshot({order:baseSnapshot.snapshot,deliveryFunding}):deliveryFunding ?');
   s=change(s,'const branchFields = [',`if(fullCash)operations.push({Put:{TableName:'staging-Holds',Item:{orderId,sk:'FULL_CASH_FUNDING_COMMITMENT',kind:'FULL_CASH_FUNDING_COMMITMENT',settlementModel:'FULL_CASH_AT_DELIVERY_V1',status:'COMMITTED',branchId,merchantId,snapshotDigest:financialSnapshot.digest,deliveryFunding,goodsExposure,platformGoodsFunding:calculation.platformGoodsDiscountFundingRequired,agreement:{id:agreementId,version:version3,termsHash:record.termsHash},createdAt:timestamp},ConditionExpression:'attribute_not_exists(orderId)'}});\n const branchFields = [`);
   s=change(s,'const preview = {',"const preview = {...(fullCash?{settlementModel:'FULL_CASH_AT_DELIVERY_V1'}:{}),");
   edits.push({start:n.getStart(ast),end:n.end,text:s});return;
  }
  ts.forEachChild(n,visit);
 }
 visit(ast);if(seen.size!==4)throw Error('FACTORY_SET_CHANGED:'+Array.from(seen));
 let output=source;for(const e of edits.sort((a,b)=>b.start-a.start))output=output.slice(0,e.start)+e.text+output.slice(e.end);
 output=change(output,'funding: { ...commercial.funding, state: commercial.funding.holdId ? "RESERVED_WITH_ORDER" : "NOT_REQUIRED" }', 'funding: { ...commercial.funding, state: commercial.settlementModel==="FULL_CASH_AT_DELIVERY_V1"?"BUDGET_COMMITTED_WITH_ORDER":commercial.funding.holdId ? "RESERVED_WITH_ORDER" : "NOT_REQUIRED" }');
 output=change(output,'order.financialSnapshot = commercial.financialSnapshot;','order.financialSnapshot = commercial.financialSnapshot;\n      if(commercial.settlementModel==="FULL_CASH_AT_DELIVERY_V1")order.exceptionPolicy=require("../../checkout-finance-runtime-222.js").createOrderExceptionPolicy(order.createdAt);');
 return {output,factories:[...seen],preservedHostBenefits:true};
}
module.exports={adapt};
if(require.main===module){const fs=require('node:fs');fs.writeFileSync(process.argv[3],adapt(fs.readFileSync(process.argv[2],'utf8')).output);}
