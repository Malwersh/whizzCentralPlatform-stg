'use strict';
const fs=require('fs'),path=require('path'),ts=require('../backend/wallet-service/node_modules/typescript'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'backend/.tmp/driver-vehicles-308');
const modules={driverOfferContext:['createStagingDriverOfferContext'],driverOfferStore:['createStagingDriverOfferStore'],driverOfferAcceptance:['createStagingDriverOfferAcceptance'],dispatchCandidates:['createStagingDispatchCandidates'],dispatchLegacy:['createStagingLegacyWaveExecutor','createStagingLegacyResponses']};
const targets=Object.values(modules).flat();
fs.mkdirSync(dir,{recursive:true});const entry=Object.entries(modules).map(([m,n])=>`export {${n.join(',')}} from '../../wallet-service/src/${m}';`).join('\n');fs.writeFileSync(path.join(dir,'entry.ts'),entry);
if(!process.argv[2]){esbuild.buildSync({entryPoints:[path.join(dir,'entry.ts')],outfile:path.join(dir,'driver-vehicles-runtime-308.js'),platform:'node',target:'node22',bundle:true,keepNames:true,logLevel:'silent'});const built=require(path.join(dir,'driver-vehicles-runtime-308.js'));for(const name of targets)if(typeof built[name]!=='function')throw Error('Missing runtime export '+name);console.log('Built vehicle runtime');process.exit(0);}
const file=process.argv[2],relative=process.argv[3]||path.basename(file),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,99,true),edits=[];
const delegate='./'+path.posix.relative(path.posix.dirname(relative),'driver-vehicles-runtime-308.js');
const declarations=new Map();
function collect(n){if(ts.isFunctionDeclaration(n)&&n.name&&n.body)declarations.set(n.name.text,n.body.getText(ast));ts.forEachChild(n,collect);}collect(ast);
function sdkNamespace(body,kind,depth=0){
 const direct=body.match(kind==='ddb'?/new ([$\w]+)\.(?:Get|Query|Scan|TransactWrite)Command\(/:/new ([$\w]+)\.AdminGetUserCommand\(/)?.[1];
 if(direct)return direct;if(depth>=3)return null;
 for(const call of body.matchAll(/\b([$\w]+)\(/g)){const helper=declarations.get(call[1]);if(helper){const found=sdkNamespace(helper,kind,depth+1);if(found)return found;}}
 return null;
}
function visit(n){if(ts.isFunctionDeclaration(n)&&n.body&&n.name){const base=targets.find(t=>new RegExp('^'+t+'[0-9]*$').test(n.name.text));if(base){
 const body=n.body.getText(ast);
 if(body.includes('ADMIN_RETRY_DDB_COMMAND_INVALID')&&body.includes('.'+base+'(...args)')){
  const revised=body.replace(/require\((['"])([^'"]*admin-retry-runtime-298\.js)\1\)/g,`require(${JSON.stringify(delegate)})`);
  if(revised===body)throw Error('Existing delegate not found: '+base);
  edits.push([n.body.getStart(ast),n.body.end,revised,base]);return;
 }
 const ddb=sdkNamespace(body,'ddb')||body.match(/const sdk\s*=\s*([$\w]+);/)?.[1]||'require("@aws-sdk/lib-dynamodb")';
 const cognito=sdkNamespace(body,'cognito')||'require("@aws-sdk/client-cognito-identity-provider")';
 const out=`{ const first=arguments[0], original=first.db, sdk=${ddb}; const args={...first,db:{send(command){const type=command?.constructor?.name?.replace(/\\d+$/,'');if(!['GetCommand','QueryCommand','ScanCommand','TransactWriteCommand'].includes(type)||typeof sdk[type]!=='function')throw Error('VEHICLE_DDB_COMMAND_INVALID');return original.send(command instanceof sdk[type]?command:new sdk[type](command.input));}}};if(first.cognito){const client=first.cognito, sdk=${cognito};args.cognito={send(command){const type=command?.constructor?.name?.replace(/\\d+$/,'');if(type!=='AdminGetUserCommand')throw Error('VEHICLE_COGNITO_COMMAND_INVALID');return client.send(command instanceof sdk[type]?command:new sdk[type](command.input));}};}return require(${JSON.stringify(delegate)}).${base}(args); }`;
 edits.push([n.body.getStart(ast),n.body.end,out,base]);return;
 }}ts.forEachChild(n,visit);}visit(ast);
let out=source;for(const [a,b,body]of edits.sort((a,b)=>b[0]-a[0]))out=out.slice(0,a)+body+out.slice(b);
fs.writeFileSync(file+'.patched',out);console.log(JSON.stringify({functions:edits.map(e=>e[3])}));
