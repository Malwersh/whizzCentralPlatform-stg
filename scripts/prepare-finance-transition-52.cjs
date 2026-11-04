'use strict';
// Overlay two freshly captured packages. This script has no AWS client or publisher.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const root=path.resolve(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function noticePatch(live,local){
 const block=s=>{const a=s.indexOf('async function codNoticeAllowed('),b=s.indexOf('function createWorker(',a);if(a<0||b<0)throw Error('NOTICE_ANCHOR_CHANGED');return s.slice(a,b);};
 let next=replaceOnce(live,block(live),block(local));
 next=replaceOnce(next,'if(!await codNoticeAllowed(client,item))suppressed=true;','if(!await codNoticeAllowed(client,item,clock()))suppressed=true;');
 next=replaceOnce(next,'if(!await codNoticeAllowed(client,item)){suppressed=true;break;}','if(!await codNoticeAllowed(client,item,clock())){suppressed=true;break;}');
 const message=s=>{const lines=s.split('\n').filter(l=>l.includes('await sender.send('));if(lines.length!==1)throw Error('NOTICE_SEND_ANCHOR_CHANGED');return lines[0];};
 next=replaceOnce(next,message(next),message(local));
 if(next!==local)throw Error('UNREVIEWED_NOTIFICATION_DELTA');
 return next;
}
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
 const inventory=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));
 const targets=['WizzUser-CreateOrder-staging','staging-wizz-wallet-notification-worker'];
 if(inventory.length!==2||targets.some(n=>inventory.filter(f=>f.name===n).length!==1))throw Error('EXACT_TWO_FUNCTION_INVENTORY_REQUIRED');
 if(fs.readFileSync(path.join(root,'backend/wallet-service/notification-worker/index.js'),'utf8').includes("require('./finance-rollout')"))throw Error('TRANSITION52_SUPERSEDED_BY_SCOPED_RELEASE');
 cp.execFileSync(process.execPath,[path.join(__dirname,'sync-delivery-quote-order-runtime.cjs'),'--check']);
 fs.mkdirSync(out,{mode:0o700});
 const customer=path.resolve(root,'../wizzuser-stg/backend/src/functions/create-order/index.js');
 const runtime=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[customer],bundle:true,platform:'node',target:'node20',write:false,logLevel:'silent'}).outputFiles[0].contents;
 const runtimeFile=path.join(out,'commercial-runtime.js');fs.writeFileSync(runtimeFile,runtime,{mode:0o600});
 const live=fs.readFileSync(path.join(audit,'staging-wizz-wallet-notification-worker/index.js'),'utf8');
 const notification=noticePatch(live,fs.readFileSync(path.join(root,'backend/wallet-service/notification-worker/index.js'),'utf8'));
 const noticeFile=path.join(out,'notification-index.js');fs.writeFileSync(noticeFile,notification,{mode:0o600});
 const result={schemaVersion:1,part:52,published:false,activated:false,environmentChanges:false,iamChanges:false,functions:[]};
 for(const f of inventory){
  const source=path.join(audit,f.name+'.zip'),destination=path.join(out,f.name+'.candidate.zip');
  const filename=f.name===targets[0]?'functions/create-order/commercial-runtime.js':'index.js';
  const replacement=f.name===targets[0]?runtimeFile:noticeFile;
  const request={mode:'patch',source,destination,expectedCodeSha256:f.codeSha256,replacements:{[filename]:replacement},additions:{}};
  const proof=JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(request),encoding:'utf8',maxBuffer:2000000}));
  const rollback=path.join(out,f.name+'.rollback.zip');fs.copyFileSync(source,rollback);fs.chmodSync(rollback,0o600);fs.chmodSync(destination,0o600);
  result.functions.push({name:f.name,baseCodeSha256:f.codeSha256,baseRevisionId:f.revisionId,...proof,replacementSourceSha256:hash(fs.readFileSync(replacement)),rollbackSha256:hash(fs.readFileSync(rollback))});
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
 return result;
}
module.exports={prepare,noticePatch};
if(require.main===module){try{const result=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify(result));}catch(e){console.error(e.message);process.exitCode=1;}}
