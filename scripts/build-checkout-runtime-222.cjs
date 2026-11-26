'use strict';
const path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),output=path.join(root,'backend/shared/checkout-finance-runtime-222.js');
// The host ZIP bundles SDK copies inside other functions; package this reader's
// own command dependencies instead of relying on the Lambda runtime SDK version.
const bytes=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/checkoutFinanceRuntime222.ts')],write:false,bundle:true,platform:'node',target:'node22',logLevel:'warning'}).outputFiles[0].contents;
if(process.argv.includes('--check')){if(!fs.existsSync(output)||!fs.readFileSync(output).equals(bytes))throw Error('CHECKOUT_FINANCE_RUNTIME_DRIFT');}else fs.writeFileSync(output,bytes);
