'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const out='/private/tmp/financial-retry-192',root=path.resolve(__dirname,'..');fs.mkdirSync(out,{recursive:true,mode:0o700});
for(const [name,entry]of Object.entries({'dispatch-cycle-runtime':'dispatchCoordinatorRuntime','financial-runtime':'driverFinancialRuntime','finance-rollout':'financeRollout'})){
 const bytes=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/'+entry+'.ts')],bundle:true,write:false,platform:'node',target:'node20',keepNames:true,logLevel:'silent'}).outputFiles[0].contents;
 fs.writeFileSync(path.join(out,name+'.js'),bytes);require(path.join(out,name+'.js'));
}
console.log('Three runtime artifacts built and loaded; no deployment.');
