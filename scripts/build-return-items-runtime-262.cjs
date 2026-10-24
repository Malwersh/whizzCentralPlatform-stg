'use strict';
const fs=require('node:fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const bytes=esbuild.buildSync({entryPoints:['backend/wallet-service/src/returnItemRuntime262.ts'],bundle:true,platform:'node',target:'node22',write:false,logLevel:'warning'}).outputFiles[0].contents;
let source=Buffer.from(bytes).toString();
// Retain the existing live platform-benefit compatibility shim used by the current financial writer.
const live=fs.readFileSync('/private/tmp/return-items-262/exception-base.js','utf8'),marker='// platformBenefitFinancialCompatibility';
if(live.includes(marker)){const start=live.indexOf(marker),end=live.indexOf('\n\n',start);const patch=live.slice(start,end+2);const anchor='function allocateDeliveryFundedOrder(value) {\n';if(!source.includes(anchor))throw Error('ALLOCATOR_ANCHOR_CHANGED');source=source.replace(anchor,anchor+patch);}
fs.writeFileSync('backend/shared/return-items-runtime-262.js',source);console.log('Built return item runtime preserving the live financial compatibility shim.');
