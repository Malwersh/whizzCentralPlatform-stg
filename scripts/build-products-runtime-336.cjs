'use strict';
// Reproducible local artifacts only; no AWS mutation.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const root=path.resolve(__dirname,'..'),e=require('../backend/wallet-service/node_modules/esbuild');
const out='/private/tmp/products-336-release/candidates',merchant=path.resolve(root,'../whizzMerchants-stg/backend');fs.mkdirSync(out,{recursive:true});
cp.execFileSync(process.execPath,[path.join(root,'backend/wallet-service/node_modules/typescript/bin/tsc'),'-p',path.join(root,'backend/wallet-service/tsconfig.json')],{stdio:'inherit'});
for(const script of ['sync-delivery-quote-order-runtime.cjs','sync-branch-product-pricing.cjs'])cp.execFileSync(process.execPath,[path.join(root,'scripts',script)],{stdio:'inherit'});
const common={absWorkingDir:root,platform:'node',target:'node20',bundle:true,external:['@aws-sdk/*'],nodePaths:[path.join(root,'backend/wallet-service/node_modules'),path.join(root,'node_modules')],logLevel:'warning'};
fs.writeFileSync(path.join(merchant,'functions/shared/product-inventory.js'),e.buildSync({...common,entryPoints:[path.join(root,'backend/wallet-service/src/productInventory.ts')],write:false}).outputFiles[0].text);
for(const [name,file] of [['merchant-products','products/product_management_handler.js'],['merchant-images','upload/image_upload_handler.js'],['merchant-discounts','discounts/discount_management_handler.js']])e.buildSync({...common,entryPoints:[path.join(merchant,'functions',file)],outfile:path.join(out,name+'.js')});
e.buildSync({...common,entryPoints:[path.join(root,'backend/inventory-service/index.js')],outfile:path.join(out,'inventory-worker.js')});
