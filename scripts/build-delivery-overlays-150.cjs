'use strict';
// Build only. These artifacts are overlays, never a replacement checkout/worktree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('../backend/wallet-service/node_modules/esbuild'),cp=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=process.argv[2];if(!out||!path.isAbsolute(out))throw Error('ABSOLUTE_OUTPUT_REQUIRED');fs.mkdirSync(out,{recursive:true,mode:0o700});
for(const script of ['sync-delivery-quote-order-runtime.cjs','sync-delivery-pricing-runtime.cjs'])cp.execFileSync(process.execPath,[path.join(__dirname,script),'--check']);
const entries={
 'commercial-runtime':path.resolve(root,'../wizzuser-stg/backend/src/functions/create-order/index.js'),
 'financial-runtime':path.join(root,'backend/wallet-service/src/driverFinancialRuntime.ts'),
 'dispatch-cycle-runtime':path.join(root,'backend/wallet-service/src/dispatchCoordinatorRuntime.ts'),
 'cod-integration':path.join(root,'backend/wallet-service/src/codIntegrationRuntime.ts'),
 'merchant-response-worker':path.join(root,'backend/wallet-service/src/merchantResponseRuntime.ts'),
 'merchant_pending_response':path.join(root,'backend/wallet-service/src/merchantResponseAdapter.ts'),
 'commercial-sharing-push':path.join(root,'backend/src/utils/commercial-sharing-push.js')
};
const rows=[];for(const [name,entry]of Object.entries(entries)){
 const external=name==='commercial-runtime'?['aws-sdk']:name==='commercial-sharing-push'?['@aws-sdk/lib-dynamodb']:[];
 const bytes=esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',target:'node20',keepNames:true,external,nodePaths:[path.join(root,'backend/node_modules'),path.join(root,'backend/wallet-service/node_modules')],write:false,logLevel:'silent'}).outputFiles[0].contents;
 const file=name+'.js';fs.writeFileSync(path.join(out,file),bytes,{mode:0o600});rows.push({file,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
fs.writeFileSync(path.join(out,'bundles.json'),JSON.stringify({part:150,reviewOnly:true,applied:false,activation:'OFF',bundles:rows},null,2)+'\n',{mode:0o600});console.log(JSON.stringify({bundles:rows.length,applied:false}));
