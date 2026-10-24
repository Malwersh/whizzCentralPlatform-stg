'use strict';
// Overlay only reviewed entries onto freshly captured live archives; never replace host configuration.
const fs=require('node:fs'),path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out='/private/tmp/cash327';
const build=(entry,file)=>esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',target:'node20',keepNames:true,outfile:file,logLevel:'silent',nodePaths:[path.join(root,'backend/wallet-service/node_modules'),path.join(root,'node_modules'),path.join(root,'../wizzuser-stg/backend/node_modules')]});
build(path.join(root,'../wizzuser-stg/backend/src/functions/create-order/index.js'),path.join(out,'create-order.js'));
build(path.join(root,'backend/wallet-service/src/cashRoundingRuntime.ts'),path.join(out,'cash-rounding-runtime-327.js'));
const source=fs.readFileSync(path.join(out,'driver-base.js'),'utf8');let next=source;
function replace(before,after){if(next.split(before).length!==2)throw Error('LIVE_PATCH_PRECONDITION: '+before);next=next.replace(before,after);}
replace('const posting = prepareFullCashJournal(offer.settlement), branchId = offer.baseOffer.branchId;',"const posting = require('./cash-rounding-runtime-327').prepareFullCashJournal(offer.settlement,order.commercialPricing?.cashRounding), branchId = offer.baseOffer.branchId;");
replace('    if (a.platformGoodsDiscountFunding.minorAmount > 0) {',"    if (!equal(budget.cashRounding??null,order.commercialPricing?.cashRounding??null)) return fail17('CASH_ROUNDING_SETTLEMENT_MISMATCH');\n    if (a.platformGoodsDiscountFunding.minorAmount > 0) {");
replace('        lines: posting.lines,', '        ...(order.commercialPricing?.cashRounding?{cashRounding:order.commercialPricing.cashRounding}:{}),\n        lines: posting.lines,');
fs.writeFileSync(path.join(out,'driver-updated.js'),next);
console.log(JSON.stringify({built:['create-order','cash-rounding-runtime'],driverNarrowPatches:3}));
build(path.join(root,'backend/staff-service/cash-rounding.js'),path.join(out,'cash-rounding-admin-327.js'));
build(path.join(root,'backend/staff-service/company-accounts.js'),path.join(out,'company-accounts-281.js'));
let staff=fs.readFileSync(path.join(out,'staff-base.js'),'utf8');
const anchor='    if (path === "/staff/pricing" || path.startsWith("/staff/pricing/"))';
if(staff.split(anchor).length!==2)throw Error('STAFF_ROUTE_PATCH_PRECONDITION');
staff=staff.replace(anchor,'    if (path === "/staff/pricing/cash-rounding" || path.startsWith("/staff/pricing/cash-rounding/")) return response(200, await require("../../cash-rounding-admin-327.js").route({db,table,guard,audit,enrolled,recent,claims},actor,method,path,input));\n'+anchor);
fs.writeFileSync(path.join(out,'staff-updated.js'),staff);

let customer=fs.readFileSync(path.join(out,'customer-cash-base.js'),'utf8');
const postingAnchor='const posting = prepareFullCashJournal(offer.settlement), branchId = offer.baseOffer.branchId;';
if(customer.split(postingAnchor).length!==2)throw Error('CUSTOMER_CASH_PATCH_PRECONDITION');
customer=customer.replace(postingAnchor,"const posting = require('./cash-rounding-runtime-327').prepareFullCashJournal(offer.settlement,order.commercialPricing?.cashRounding), branchId = offer.baseOffer.branchId;");
const budgetCheck=customer.match(/if \(a\d*.platformGoodsDiscountFunding.minorAmount > 0\) \{/g);
if(budgetCheck?.length!==1)throw Error('CUSTOMER_CASH_BUDGET_PATCH_PRECONDITION');
const failure=customer.match(/budget.platformGoodsFunding, a\d*.platformGoodsDiscountFunding\)\) return (\w+)\(/)?.[1];
if(!failure)throw Error('CUSTOMER_CASH_FAILURE_PRECONDITION');
customer=customer.replace(budgetCheck[0],"if(!equal(budget.cashRounding??null,order.commercialPricing?.cashRounding??null)) return "+failure+"('CASH_ROUNDING_SETTLEMENT_MISMATCH');\n    "+budgetCheck[0]);
if(customer.split('lines: posting.lines,').length!==2)throw Error('CUSTOMER_CASH_JOURNAL_PRECONDITION');
customer=customer.replace('lines: posting.lines,','...(order.commercialPricing?.cashRounding?{cashRounding:order.commercialPricing.cashRounding}:{}),lines: posting.lines,');
fs.writeFileSync(path.join(out,'customer-cash-updated.js'),customer);
