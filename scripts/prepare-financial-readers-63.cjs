'use strict';
// Build review artifacts only; publication requires a separate hash/configuration CAS.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out='/private/tmp/finance63';
for(const cmd of ['sync-delivery-quote-order-runtime.cjs','build-delivery-quote-runtime.cjs'])cp.execFileSync(process.execPath,[path.join(root,'scripts',cmd)],{stdio:'inherit'});
const entries={quote:'../wizzuser-stg/backend/src/functions/delivery-quotes/index.js',driver:'backend/wallet-service/src/driverFinancialRuntime.ts',writer:'../wizzuser-stg/backend/src/functions/create-order/index.js'};
for(const [key,entry]of Object.entries(entries)){
 const r=esbuild.buildSync({entryPoints:[path.resolve(root,entry)],bundle:true,platform:'node',target:key==='writer'?'node20':'node22',keepNames:key!=='writer',external:key==='writer'?['aws-sdk']:[],write:false,metafile:true,logLevel:'silent'});
 fs.writeFileSync(path.join(out,key+'.built.js'),r.outputFiles[0].contents);fs.writeFileSync(path.join(out,key+'.metafile.json'),JSON.stringify(r.metafile));
}
console.log(JSON.stringify({built:3,published:false}));
