'use strict';
// Offline artifacts for review. Never reads AWS, changes flags, or deploys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('Provide a fresh absolute artifact directory');
if(fs.existsSync(path.join(out,'manifest.json')))throw Error('Artifact manifest already exists');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const entries={
 'delivery-agreement-runtime-283':'deliveryAgreementCompositionRuntime',
 'delivery-quotes-runtime':'deliveryQuoteRuntime',
 'customer-cash-runtime-266':'customerCashRuntime266',
 'driver-financial-runtime':'driverFinancialRuntime',
 'merchant-response-runtime':'merchantResponseRuntime'
};
const manifest={schemaVersion:1,deployed:false,createdAt:new Date().toISOString(),requiresCoordinatedHostReview:true,artifacts:[]};
fs.mkdirSync(out,{recursive:true});
for(const [name,source] of Object.entries(entries)){
 const entry=path.join(root,'backend/wallet-service/src',source+'.ts'),file=path.join(out,name+'.js');
 esbuild.buildSync({entryPoints:[entry],bundle:true,platform:'node',target:'node20',keepNames:true,outfile:file,logLevel:'silent'});
 const bytes=fs.readFileSync(file);manifest.artifacts.push({name,source:path.relative(root,entry),file:name+'.js',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({deployed:false,artifacts:manifest.artifacts.length,out}));
