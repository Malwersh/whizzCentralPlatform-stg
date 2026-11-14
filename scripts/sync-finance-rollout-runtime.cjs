'use strict';
const fs=require('node:fs'),path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),bytes=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/financeRollout.ts')],bundle:true,platform:'node',target:'node20',external:['@aws-sdk/lib-dynamodb'],write:false,logLevel:'silent'}).outputFiles[0].contents;
for(const relative of ['backend/wallet-service/notification-worker/finance-rollout.js','backend/staff-service/finance-rollout.js','backend/src/utils/finance-rollout.js']){
 const file=path.join(root,relative);if(process.argv.includes('--check')){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(bytes))throw Error('FINANCE_ROLLOUT_RUNTIME_DRIFT: '+relative);}else fs.writeFileSync(file,bytes);
}
