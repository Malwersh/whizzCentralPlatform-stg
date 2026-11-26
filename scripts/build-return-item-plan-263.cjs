'use strict';
const fs=require('node:fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
esbuild.buildSync({entryPoints:['backend/wallet-service/src/returnItemPlanRuntime263.ts'],bundle:true,platform:'node',target:'node22',outfile:'backend/shared/return-item-plan-runtime-263.js',logLevel:'warning'});
const source=fs.readFileSync('backend/shared/return-item-plan-runtime-263.js','utf8');if(source.includes('function createExceptionFinancialClosure')||source.includes('function allocateDeliveryFundedOrder'))throw Error('Unexpected unrelated financial code in the plan bundle');
console.log('Built isolated custody-plan factory; no financial handlers rebuilt.');
