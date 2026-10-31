'use strict';
// Build shared runtime candidates. No publishing, financial writes or activation.
const fs=require('node:fs'),path=require('node:path'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out='/private/tmp/full-cash-208/runtime';fs.mkdirSync(out,{recursive:true,mode:0o700});
const entries={
 'financial-runtime':'backend/wallet-service/src/driverFinancialRuntime.ts',
 'dispatch-cycle-runtime':'backend/wallet-service/src/dispatchCoordinatorRuntime.ts',
 'finance-rollout':'backend/wallet-service/src/financeRollout.ts',
 'merchant-pending-runtime':'backend/wallet-service/src/merchantPendingRuntime.ts',
 'merchant-response-runtime':'backend/wallet-service/src/merchantResponseRuntime.ts',
 'cod-integration-runtime':'backend/wallet-service/src/codIntegrationRuntime.ts',
 'commercial-runtime':'../wizzuser-stg/backend/src/functions/create-order/index.js'
};
const manifest=[];
for(const [name,entry]of Object.entries(entries)){
 const file=path.join(out,name+'.js');esbuild.buildSync({entryPoints:[path.resolve(root,entry)],bundle:true,platform:'node',target:'node18',keepNames:true,external:['@aws-sdk/*','aws-sdk','uuid'],outfile:file,logLevel:'silent'});
 require('node:child_process').execFileSync(process.execPath,['--check',file]);manifest.push({name,entry,bytes:fs.statSync(file).size,sha256:require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({status:'BUILT_NOT_PUBLISHED',sdk:'EXTERNAL_HOST_OR_RUNTIME',entries:manifest},null,2)+'\n');console.log(JSON.stringify(manifest.map(x=>({name:x.name,bytes:x.bytes}))));
