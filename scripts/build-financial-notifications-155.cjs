'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('ABSOLUTE_PRIVATE_OUTPUT_REQUIRED');
fs.mkdirSync(out,{recursive:true,mode:0o700});
const entries={
 'financial-offer-notification-runtime':'financialOfferNotification.ts',
 'dispatch-cycle-runtime':'dispatchCoordinatorRuntime.ts',
 'financial-runtime':'driverFinancialRuntime.ts',
};
const esbuild=require('../backend/wallet-service/node_modules/esbuild'),bundles=[];
for(const [name,entry]of Object.entries(entries)){
 const bytes=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src',entry)],bundle:true,write:false,platform:'node',target:'node20',keepNames:true,nodePaths:[path.join(root,'backend/node_modules')],logLevel:'silent'}).outputFiles[0].contents;
 const file=path.join(out,name+'.js');fs.writeFileSync(file,bytes,{mode:0o600});const loaded=require(file);
 const expected=name==='financial-offer-notification-runtime'?['createStagingFinancialPushHandler']:name==='financial-runtime'?['financialAcceptanceHandler','readFinancialOffer']:['runHostedFinancialWave','runHostedFinancialTick'];
 for(const key of expected)if(typeof loaded[key]!=='function')throw Error('MISSING_EXPORT '+key);
 bundles.push({file:path.basename(file),sha256:crypto.createHash('sha256').update(bytes).digest('hex'),exportsVerified:expected});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({part:155,localOnly:true,deployed:false,bundles},null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({builtAndLoaded:bundles.length,deployed:false}));
