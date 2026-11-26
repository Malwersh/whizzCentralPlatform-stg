"use strict";
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'backend/staff-service/settlement-runtime.js');
const bytes=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/merchantSettlementAdminRuntime.ts')],write:false,bundle:true,platform:'node',target:'node22',external:['@aws-sdk/*'],logLevel:'warning'}).outputFiles[0].contents;
if(process.argv.includes('--check')){if(!fs.existsSync(output)||!fs.readFileSync(output).equals(bytes))throw Error('SETTLEMENT_RUNTIME_DRIFT');}else fs.writeFileSync(output,bytes);
