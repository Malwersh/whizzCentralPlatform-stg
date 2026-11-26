'use strict';
// Read-only AWS inventory/download. Never saves environment values or signed URLs.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),https=require('node:https');
const {LambdaClient,GetFunctionCommand,ListFunctionsCommand}=require('@aws-sdk/client-lambda');
const {STSClient,GetCallerIdentityCommand}=require('@aws-sdk/client-sts');
const {execFileSync}=require('node:child_process');
const region='us-east-1',account='699561669180',out=process.argv[2],hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const gates=['DISPATCH_CYCLE_MODE','DISPATCH_LEGACY_HOST_MODE','DISPATCH_RESTART_START_MODE','DISPATCH_REVIEW_MODE','DISPATCH_REVIEW_EXECUTION_MODE','PINNED_LEGACY_PUSH_MODE','DISPATCH_RESPONSE_INTEGRATION_MODE','FINANCIAL_DISPATCH_MODE'];
async function download(url,redirects=0){const u=new URL(url);if(u.protocol!=='https:'||!u.hostname.endsWith('.amazonaws.com')||redirects>2)throw Error('SIGNED_PACKAGE_HOST_INVALID');return new Promise((resolve,reject)=>{https.get(u,r=>{if([301,302,307,308].includes(r.statusCode)){r.resume();return download(new URL(r.headers.location,u).href,redirects+1).then(resolve,reject);}if(r.statusCode!==200){r.resume();return reject(Error('PACKAGE_DOWNLOAD_FAILED'));}const chunks=[];let bytes=0;r.on('data',b=>{bytes+=b.length;if(bytes>100*1024*1024)r.destroy(Error('PACKAGE_SIZE_LIMIT'));else chunks.push(b);});r.on('end',()=>resolve(Buffer.concat(chunks)));r.on('error',reject);}).on('error',reject);});}
async function audit(){
 if(!out||!path.isAbsolute(out)||fs.existsSync(out)||process.env.AWS_PROFILE!=='Wizz_stg_UserApp'||process.env.AWS_REGION!==region)throw Error('NEW_ABSOLUTE_OUTPUT_AND_STAGING_PROFILE_REQUIRED');
 if((await new STSClient({region}).send(new GetCallerIdentityCommand({}))).Account!==account)throw Error('STAGING_ACCOUNT_REQUIRED');
 const client=new LambdaClient({region});let functions=[],marker;do{const r=await client.send(new ListFunctionsCommand({Marker:marker}));functions.push(...r.Functions??[]);marker=r.NextMarker;}while(marker);
 const drivers=functions.filter(f=>/driver.?api/i.test(f.FunctionName??'')&&/stag/i.test(f.FunctionName??''));if(drivers.length!==1)throw Error('EXACT_STAGING_DRIVER_API_REQUIRED');
 const names=['WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject','wizzcentral-notifications-staging-pushSendWaveOffer','staging-wizz-staff-service','staging-cod-integration',drivers[0].FunctionName];
 fs.mkdirSync(out,{mode:0o700});const inventory={schemaVersion:1,capturedAt:new Date().toISOString(),account,region,published:false,functions:[]};
 for(const name of names){const r=await client.send(new GetFunctionCommand({FunctionName:name})),c=r.Configuration,env=c.Environment?.Variables??{},stack=r.Tags?.['aws:cloudformation:stack-name']??'';
  if(c.FunctionArn!==`arn:aws:lambda:${region}:${account}:function:${name}`||c.PackageType!=='Zip'||!r.Code?.Location||!(/stag/i.test(name)||/stag/i.test(stack))||env.STAGE&&env.STAGE!=='staging')throw Error('FUNCTION_STAGING_BINDING_REQUIRED');
  const bytes=await download(r.Code.Location);if(crypto.createHash('sha256').update(bytes).digest('base64')!==c.CodeSha256)throw Error('PACKAGE_DIGEST_MISMATCH');
  fs.writeFileSync(path.join(out,name+'.zip'),bytes,{mode:0o600});
  const f={name,arn:c.FunctionArn,handler:c.Handler,codeSha256:c.CodeSha256,revisionId:c.RevisionId,role:c.Role,runtime:c.Runtime,timeout:c.Timeout,lastModified:c.LastModified,stack,stage:env.STAGE??null,environmentDigest:hash(JSON.stringify(Object.fromEntries(Object.keys(env).sort().map(k=>[k,env[k]])))),gates:Object.fromEntries(gates.map(k=>[k,env[k]??null])),dependenciesPresent:Object.fromEntries(['NOTIFICATIONS_API_BASE','NOTIFICATIONS_INTERNAL_KEY','USER_POOL_ID','WAVESYSTEM_HANDLE_DRIVER_ACCEPT_FUNCTION_NAME','DISPATCH_HOST_RULE_ARN'].map(k=>[k,!!env[k]])),zipSha256:hash(bytes)};
  inventory.functions.push(f);fs.writeFileSync(path.join(out,'inventory.json'),JSON.stringify(inventory,null,2)+'\n',{mode:0o600});
 }
 // Only top-level application JS, not dependencies, certificates or env files.
 execFileSync('python3',['-c',`import zipfile,pathlib,json,sys\np=pathlib.Path(sys.argv[1])\nfor f in json.loads((p/'inventory.json').read_text())['functions']:\n z=zipfile.ZipFile(p/(f['name']+'.zip'));names=z.namelist()\n if len(names)!=len(set(names)) or sum(e.file_size for e in z.infolist())>250*1024*1024:raise ValueError('UNSAFE_ARCHIVE')\n for n in names:\n  if n.startswith('/') or '\\\\' in n or '..' in n.split('/'):raise ValueError('UNSAFE_ARCHIVE_PATH')\n  if n.endswith('.js') and 'node_modules/' not in n:\n   dest=p/'source'/f['name']/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(n));dest.chmod(0o600)\n`,out],{stdio:'pipe'});
 console.log(JSON.stringify({account,region,functions:inventory.functions.map(f=>({name:f.name,revisionId:f.revisionId})),environmentValuesSaved:false,published:false}));
}
if(require.main===module)audit().catch(e=>{console.error('DISPATCH_AUDIT_FAILED:',/^[A-Z_]+$/.test(e.message??'')?e.message:e.name);process.exitCode=1;});
module.exports={audit};
