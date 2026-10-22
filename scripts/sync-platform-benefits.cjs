'use strict';
const fs=require('fs'),path=require('path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..');const bytes=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/platformBenefits.ts')],bundle:true,platform:'node',target:'node20',external:['@aws-sdk/lib-dynamodb'],write:false}).outputFiles[0].contents;
for(const name of ['backend/staff-service/platform-benefits-runtime.js','../wizzuser-stg/backend/src/functions/shared/platform-benefits-runtime.js']){const p=path.resolve(root,name);if(process.argv.includes('--check')){if(!fs.existsSync(p)||!fs.readFileSync(p).equals(bytes))throw Error('PLATFORM_BENEFITS_RUNTIME_DRIFT');}else fs.writeFileSync(p,bytes);}
