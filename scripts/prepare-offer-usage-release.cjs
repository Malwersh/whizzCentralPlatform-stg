'use strict';
// Build reviewable pending-response bundles; this script never uploads or deploys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('Provide an absolute artifact directory');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
fs.mkdirSync(out,{recursive:true});
const manifest=[];
for(const [source,name] of [['merchantResponseAdapter','merchant_pending_response.js'],['merchantResponseRuntime','merchant_response_runtime.js']]){
 const outfile=path.join(out,name);
 esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src',source+'.ts')],outfile,bundle:true,platform:'node',target:'node22',keepNames:true});
 manifest.push({source,artifact:outfile,sha256:crypto.createHash('sha256').update(fs.readFileSync(outfile)).digest('hex')});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({deployed:false,artifacts:manifest},null,2)+'\n');
console.log(JSON.stringify({deployed:false,artifacts:manifest.map(x=>x.artifact)}));
