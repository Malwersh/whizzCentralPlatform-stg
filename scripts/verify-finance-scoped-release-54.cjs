'use strict';
// Offline candidate verification. No Lambda invocation or provider requests.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module');
const {scopeEnv,scopePin}=require('../backend/wallet-service/test/helpers/finance-rollout-fixture.cjs');
async function verify(audit,release){
 const m=JSON.parse(fs.readFileSync(path.join(release,'manifest.json')));
 if(m.published||m.activated||m.publicationReady||m.functions.length!==21)throw Error('CLOSED_CANDIDATES_REQUIRED');
 const proof=JSON.parse(cp.execFileSync('python3',['-c',`import sys,pathlib,json,zipfile,hashlib,base64
r=pathlib.Path(sys.argv[1]); a=pathlib.Path(sys.argv[2]); m=json.loads((r/'manifest.json').read_text()); count=0
for f in m['functions']:
 before=zipfile.ZipFile(a/(f['name']+'.zip')); after=zipfile.ZipFile(r/(f['name']+'.candidate.zip'))
 assert base64.b64encode(hashlib.sha256((r/(f['name']+'.candidate.zip')).read_bytes()).digest()).decode()==f['candidateCodeSha256']
 assert (r/(f['name']+'.rollback.zip')).read_bytes()==(a/(f['name']+'.zip')).read_bytes()
 assert len(after.namelist())==len(set(after.namelist()))
 for n in before.namelist():
  if n not in f['replacedFiles']:assert before.read(n)==after.read(n);count+=1
print(json.dumps({'archives':len(m['functions']),'unchangedEntriesVerified':count}))`,release,audit],{encoding:'utf8',maxBuffer:1000000}));
 const read=(name,n)=>cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',path.join(release,name+'.candidate.zip'),n],{encoding:'utf8',maxBuffer:20000000});
 const live=read('staging-driver-financial-accept','index.js');
 const tail=live.slice(live.lastIndexOf('// backend/wallet-service/src/driverFinancialRuntime.ts'));
 const alias=tail.match(/([\w$]+)\.DynamoDBDocumentClient/)[1];
 const probe=new Module(path.join(release,'sdk-probe.cjs'),module);probe.filename=path.join(release,'sdk-probe.cjs');probe.paths=module.paths;
 probe._compile(live+`\nmodule.exports.__sdkProbe=input=>new ${alias}.GetCommand(input);`,probe.filename);
 const guardModule=new Module(path.join(release,'guard-probe.cjs'),module);guardModule.filename=path.join(release,'guard-probe.cjs');guardModule.paths=module.paths;
 guardModule._compile(read('staging-driver-financial-accept','finance-rollout.js'),guardModule.filename);
 const env=scopeEnv(),row={PK:'ORDER#order',SK:'META',orderId:'order',userSub:'customer',storeId:'branch',financeRollout:scopePin(env,'order')};let reads=0;
 const guarded=guardModule.exports.createFinanceRollout({env,db:{send:async c=>{reads++;if(c.input.TableName!=='WizzOrders')throw Error('UNEXPECTED_TABLE');return {Item:row};}}});
 await guarded.db.send(probe.exports.__sdkProbe({TableName:'WizzOrders',Key:{PK:'ORDER#order',SK:'META'},ConsistentRead:true}));
 if(reads<1)throw Error('PUBLISHED_SDK_GUARD_NOT_EXERCISED');
 for(const f of m.functions){
  for(const n of [...f.replacedFiles,...f.addedFiles]){
   const data=read(f.name,n);if(!data.trim())throw Error('EMPTY_REPLACEMENT');
   if(n.endsWith('commercial-order-router.js')&&!data.includes('financeRollout'))throw Error('PRIVACY_PROJECTION_MISSING');
  }
 }
 return {...proof,publishedFinancialSDKCompatible:true,providerCalls:0,awsMutations:0,published:false,activated:false};
}
module.exports={verify};
if(require.main===module)verify(process.argv[2],process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
