'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),dir='/private/tmp/sharing76/probe',file=dir+'/create-order/index.js';fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(dir+'/shared',{recursive:true});fs.copyFileSync(root+'/backend/src/utils/campaign-version.js',dir+'/shared/campaign-version.js');
const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file)).concat(Module._nodeModulePaths(root));m._compile(fs.readFileSync('/private/tmp/sharing76/commercial-runtime.js','utf8')+'\nmodule.exports.__probe=require_orderCommercialSource().createStagingCommercialSource;',file);
const {fixture}=require('../backend/wallet-service/test/helpers/commercial-source-fixture.cjs');
(async()=>{
 for(const source of ['MERCHANT','PLATFORM']){const f=fixture('org','owner',m.exports.__probe);f.funded();f.records.delete('staging-MerchantPlatform|'+JSON.stringify({pk:'BRANCH#b1',sk:'COMMERCIAL_SHARING#MERCHANT#d1'}));f.input.discount.snapshot.source=source;const r=await f.prepare();assert.equal(r.funding.amount.minorAmount,source==='PLATFORM'?1000000:0);}
 const f=fixture('org','owner',m.exports.__probe);f.funded();assert.equal((await f.prepare()).funding.amount.minorAmount,500000);f.input.discount.snapshot.version=2;f.input.discount.campaign.version=2;assert.equal((await f.prepare()).funding.amount.minorAmount,0);
 console.log(JSON.stringify({passed:true,actualBundledCandidateLoaded:true,merchantDefault:true,platformDefault:true,sharing:true,campaignEditInvalidatesSharing:true}));
})().catch(e=>{console.error(e);process.exitCode=1;});
