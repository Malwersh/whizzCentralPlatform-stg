'use strict';
// Build an isolated informational reader. This script never deploys or changes AWS settings.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
(async()=>{
 const destination=process.argv[2];
 if(!destination||!path.isAbsolute(destination))throw Error('Provide an absolute output directory.');
 if(fs.existsSync(destination))throw Error('Output directory must be new.');
 const result=await esbuild.build({entryPoints:[path.resolve(__dirname,'../backend/wallet-service/src/storefrontRouteRuntime.ts')],bundle:true,platform:'node',target:'node20',format:'cjs',write:false});
 fs.mkdirSync(destination,{recursive:true});const bytes=Buffer.from(result.outputFiles[0].contents);
 fs.writeFileSync(path.join(destination,'storefront-route-runtime.js'),bytes);
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({kind:'STOREFRONT_ROUTE',informationalOnly:true,files:{'storefront-route-runtime.js':crypto.createHash('sha256').update(bytes).digest('hex')}},null,2)+'\n');
 console.log('Built route reader; no deployment performed.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
