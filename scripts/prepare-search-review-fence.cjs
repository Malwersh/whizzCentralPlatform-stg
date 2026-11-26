'use strict';
// Preserve live legacy dispatch pricing; append only the explicit review fence.
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const [audit,out]=process.argv.slice(2),name='WaveSystem_CreateDispatchJob';if(!path.isAbsolute(audit||'')||!path.isAbsolute(out||'')||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');fs.mkdirSync(out,{mode:0o700});
const c=JSON.parse(fs.readFileSync(path.join(audit,name+'.private.json'))),source=path.join(audit,name+'.zip');
const bridge=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
const before=Buffer.from(bridge({mode:'read',source,expectedCodeSha256:c.CodeSha256,name:'index.js'}).base64,'base64').toString();const anchor='async function createDispatchJobForOrder(order, excludedDrivers = []) {\n';
const added="  // Search exhaustion requires an explicit reviewed recovery, never a stream-triggered restart.\n  if(order.financialSearch?.status==='no_driver_available'&&order.financialSearch?.reviewStatus==='REQUIRED')return {success:true,skipped:true,reason:'FINANCIAL_SEARCH_REVIEW_REQUIRED'};\n";
const file=path.join(out,'index.js');fs.writeFileSync(file,replaceOnce(before,anchor,anchor+added));cp.execFileSync(process.execPath,['--check',file]);const changed=bridge({mode:'patch',source,expectedCodeSha256:c.CodeSha256,destination:path.join(out,name+'.zip'),replacements:{'index.js':file},additions:{}});
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,stage:'staging',financialActivation:'OFF',functions:[{name,baseCodeSha256:c.CodeSha256,baseRevisionId:c.RevisionId,handler:c.Handler,...changed}],legacyPricingUnchanged:true,unpublishedLocalPricingNotCopied:true},null,2)+'\n');console.log('Prepared one-file review fence preserving live pricing');
