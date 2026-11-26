'use strict';
// Offline only. Installing this bundle does not authorize LEGACY_RESPONSES.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('ABSOLUTE_OUTPUT_REQUIRED');
const bytes=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/dispatchLegacyBridgeRuntime.ts')],platform:'node',target:'node20',bundle:true,keepNames:true,write:false,logLevel:'silent'}).outputFiles[0].contents;
fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'pinned-legacy-runtime.js'),bytes);
const manifest={schemaVersion:1,mode:'OFF',publicationReady:false,destination:'STAGING_DRIVER_API',file:'pinned-legacy-runtime.js',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),requiredAssignmentRuntime:'dispatch-cycle-runtime.js with atomic DISPATCH_ACCEPTANCE marker',requiredTarget:'arn:aws:lambda:us-east-1:699561669180:function:WaveSystem_HandleDriverAccept',blockers:['Coordinated driver API and assignment Lambda bundles, live IAM and table verification','Reservation service identity/metadata and lost-response integration test','Pending/review UI; response outbox delivery/client behavior and retention live verification','Live legacy source coverage and coordinated sender/client verification; central policy rollout']};
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify(manifest));
