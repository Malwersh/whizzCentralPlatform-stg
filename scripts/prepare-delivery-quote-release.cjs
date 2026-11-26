'use strict';
// Produces local review artifacts only. No AWS, upload, IAM mutation or activation commands.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const yaml = require('../backend/wallet-service/node_modules/js-yaml');
const {patchLiveOrder, sha256} = require('./prepare-delivery-quote-order.cjs');
const central = path.resolve(__dirname, '..'), customer = path.resolve(central, '../wizzuser-stg');
const tags = ['Ref','Sub','GetAtt','And','Or','Not','Equals','If','Join','Select','Split','FindInMap','ImportValue','Condition'];
const schema = yaml.CORE_SCHEMA.extend(tags.flatMap(tag => ['scalar','sequence','mapping'].map(kind => new yaml.Type('!'+tag,
 {kind, construct: value => ({[tag === 'Ref' || tag === 'Condition' ? tag : 'Fn::'+tag]: value})}))));
const readTemplate = filename => yaml.load(fs.readFileSync(filename, 'utf8'), {schema}); // duplicate keys fail here
function bridge(request) {
 try { return JSON.parse(cp.execFileSync('python3', [path.join(__dirname, 'quote-release-archive.py')],
  {input: JSON.stringify(request), encoding:'utf8', maxBuffer: 8*1024*1024})); }
 catch (e) { let code;try {code=JSON.parse(String(e.stdout)).error;}catch{} throw Error(/^[A-Z_]+$/.test(code||'')?code:'ARCHIVE_BRIDGE_FAILED'); }
}
function prepare({inspectionFile, liveDirectory, outputDirectory}) {
 const evidence = JSON.parse(fs.readFileSync(inspectionFile, 'utf8'));
 if (evidence.accountId !== '699561669180' || evidence.region !== 'us-east-1' || evidence.readOnly !== true || evidence.apiId !== '4jut6787c8') throw Error('STAGING_EVIDENCE_REQUIRED');
 if (fs.existsSync(outputDirectory)) throw Error('OUTPUT_MUST_BE_NEW');
 if (fs.readFileSync(path.join(customer,'backend/src/functions/create-order/index.js'),'utf8').includes('createStagingCommercialSource')) throw Error('COMMERCIAL_RELEASE_REVIEW_REQUIRED');
 const orderName = 'WizzUser-CreateOrder-staging', workerName = 'staging-account-deletion-worker';
 const order = evidence.functions[orderName], worker = evidence.functions[workerName];
 for (const info of [order, worker]) if (!info?.exists || !info.codeSha256 || !info.revisionId || !info.roleArn?.startsWith('arn:aws:iam::699561669180:role/')) throw Error('LIVE_FUNCTION_EVIDENCE_REQUIRED');
 if (order.handler !== 'functions/create-order/index.handler' || worker.handler !== 'worker.handler') throw Error('LIVE_HANDLER_CHANGED');
 const app = readTemplate(path.join(customer, 'backend/template.yaml'));
 const deletion = readTemplate(path.join(central, 'backend/account-deletion/template.yaml'));
 if (app.Resources.CreateOrderFunction.Properties.Environment.Variables.DELIVERY_QUOTE_MODE !== 'OFF' ||
     app.Resources.DeliveryQuotesFunction.Properties.Environment.Variables.DELIVERY_QUOTES_ENABLED !== 'false' ||
     deletion.Parameters.DeliveryQuotesEnabled.Default !== 'false') throw Error('ACTIVATION_MUST_STAY_OFF');
 fs.mkdirSync(outputDirectory, {recursive: true, mode:0o700});
 const save = (name, bytes) => {const target=path.join(outputDirectory,name);fs.writeFileSync(target,bytes,{mode:0o600});return target;};
 const json = (name, value) => save(name, JSON.stringify(value, null, 2)+'\n');
 const sourceZip = name => path.join(liveDirectory, name+'.zip');
 const readLive = (name, info, file) => Buffer.from(bridge({mode:'read',source:sourceZip(name),expectedCodeSha256:info.codeSha256,name:file}).base64,'base64').toString('utf8');
 const liveOrder = readLive(orderName, order, 'functions/create-order/index.js');
 const localOrder = fs.readFileSync(path.join(customer,'backend/src/functions/create-order/index.js'),'utf8');
 const patch = patchLiveOrder(liveOrder,localOrder,order.files['functions/create-order/index.js']);
 const candidate = save('create-order.candidate.js',patch.source);
 cp.execFileSync(process.execPath,['--check',candidate]);
 const runtimeRoot=path.join(customer,'backend/src/functions/create-order/quote-runtime');
 const orderAdditions = {
  'functions/create-order/account-guard.js':path.join(customer,'backend/src/functions/create-order/account-guard.js'),
  'functions/delivery-quotes/runtime.js':path.join(customer,'backend/src/functions/delivery-quotes/runtime.js'),
  ...Object.fromEntries(['money','deliveryQuoteRecord','deliveryQuoteOrder'].map(name=>['functions/create-order/quote-runtime/'+name+'.js',path.join(runtimeRoot,name+'.js')]))
 };
 const orderArchive=bridge({mode:'patch',source:sourceZip(orderName),destination:path.join(outputDirectory,'create-order.candidate.zip'),
  expectedCodeSha256:order.codeSha256,replacements:{'functions/create-order/index.js':candidate},additions:orderAdditions});
 // Worker changes must remain exactly the known quote-cleanup delta; unrelated local changes cannot enter a candidate.
 const workerReplacements={};
 const delta = {
  'worker.js':[
   ['verifiedMutationGuards=false,settings})','verifiedMutationGuards=false,settings,deliveryQuotesEnabled=false})'],
   ['customerCleanup({db,cognito,connections,requestTable,archiveTable})','customerCleanup({db,cognito,connections,requestTable,archiveTable,deliveryQuotesEnabled})'],
   ["if(row.actorType==='CUSTOMER')return createWorker(config).process", "if(row.actorType==='CUSTOMER')return createWorker({...config,deliveryQuotesEnabled:process.env.DELIVERY_QUOTES_ENABLED==='true'}).process"]
  ],
  'customer-cleanup.js':[
   [' actorType=\'CUSTOMER\',pool=POOL',' deliveryQuotesEnabled=false,actorType=\'CUSTOMER\',pool=POOL'],
   ["if(step==='personalData')return personal(r,job);","if(step==='personalData'){if(actorType==='CUSTOMER'&&deliveryQuotesEnabled)await require('./customer-delivery-quotes').purge({db,r,job,requestTable,clock,maxPages});return personal(r,job);}"]
  ]
 };
 const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
 for(const [name, edits] of Object.entries(delta)) {
  let source=readLive(workerName,worker,name);
  for(const [before,after] of edits) source=replaceOnce(source,before,after);
  if(source!==fs.readFileSync(path.join(central,'backend/account-deletion',name),'utf8'))throw Error('UNREVIEWED_CLEANUP_SOURCE_CHANGE');
  workerReplacements[name]=save(name+'.candidate.js',source);
 }
 const workerArchive=bridge({mode:'patch',source:sourceZip(workerName),destination:path.join(outputDirectory,'customer-cleanup.candidate.zip'),
  expectedCodeSha256:worker.codeSha256,replacements:workerReplacements,additions:{'customer-delivery-quotes.js':path.join(central,'backend/account-deletion/customer-delivery-quotes.js')}});
 const quoteArchive=bridge({mode:'new',destination:path.join(outputDirectory,'quote-api.candidate.zip'),additions:{
  'functions/delivery-quotes/index.js':path.join(customer,'backend/src/functions/delivery-quotes/index.js'),
  'functions/delivery-quotes/runtime.js':path.join(customer,'backend/src/functions/delivery-quotes/runtime.js'),
  'functions/create-order/account-guard.js':path.join(customer,'backend/src/functions/create-order/account-guard.js')
 }});
 // Candidate policies are additions, never replacements for existing role policies.
 const orderStatements=app.Resources.CreateOrderFunction.Properties.Policies.find(p=>p['Fn::If']?.[0]==='IsQuoteStaging')['Fn::If'][1].Statement;
 const cleanupStatements=deletion.Resources.Worker.Properties.Policies[0].Statement;
 const quoteStatements=app.Resources.DeliveryQuotesFunction.Properties.Policies[0].Statement;
 json('environment-updates.review.json', {mergeIntoExistingEnvironment:true,replaceEntireEnvironment:false,
  order:{USERS_TABLE:'WizzUser_users_staging',USER_POOL_ID:'us-east-1_TpyyrVkEE',USER_POOL_CLIENT_ID:'4a9e8o3em311eq2rgckp0pd2s9',DELIVERY_QUOTE_MODE:'OFF'},
  cleanup:{DELIVERY_QUOTES_ENABLED:'false'},
  quoteApi:{ENVIRONMENT:'staging',USERS_TABLE:'WizzUser_users_staging',USER_POOL_ID:'us-east-1_TpyyrVkEE',USER_POOL_CLIENT_ID:'4a9e8o3em311eq2rgckp0pd2s9',DELIVERY_QUOTES_ENABLED:'false',DELIVERY_QUOTE_MAX_PER_MINUTE:''},
  mapboxSecretArnSource:'Output of the separately reviewed credential-container stack; never a token',
  warning:'Review client binding against live Cognito. Enable cleanup after table creation and synthetic tests, before enabling quote writes. Preserve every other environment variable and deletion guard.'});
 json('order-iam-additions.json',{Version:'2012-10-17',Statement:orderStatements});
 json('cleanup-iam-additions.json',{Version:'2012-10-17',Statement:cleanupStatements});
 json('quote-iam-without-secret.json',{Version:'2012-10-17',Statement:quoteStatements});
 fs.copyFileSync(path.join(central,'backend/wallet-service/delivery-quotes.staging.json'),path.join(outputDirectory,'quote-table.template.json'));
 fs.copyFileSync(path.join(central,'backend/wallet-service/routing-credentials.staging.json'),path.join(outputDirectory,'mapbox-secret.template.json'));
 for(const [name,label] of [[orderName,'order'],[workerName,'cleanup']])fs.copyFileSync(sourceZip(name),path.join(outputDirectory,label+'.rollback.zip'));
 const manifest={schemaVersion:1,scope:'STAGING_QUOTE_PREPARATION_ONLY',accountId:evidence.accountId,region:evidence.region,
  deployable:false,activationReady:false,cloudWrites:false,inspectionSha256:sha256(fs.readFileSync(inspectionFile)),
  functions:{[orderName]:{baseRevisionId:order.revisionId,baseCodeSha256:order.codeSha256,roleArn:order.roleArn,...orderArchive,sourceEdits:patch.edits.map(e=>({beforeSha256:sha256(e.before),afterSha256:sha256(e.after)}))},
   'WizzUser-DeliveryQuotes-staging':{newFunction:true,...quoteArchive},
   [workerName]:{baseRevisionId:worker.revisionId,baseCodeSha256:worker.codeSha256,roleArn:worker.roleArn,...workerArchive}},
  flags:{api:'false',order:'OFF',customerCleanup:'false',flutterDefault:false},
  rolloutOrder:['create table and credential container; initialize credential securely','publish and verify cleanup package and IAM; enable quote cleanup only',
   'configure approved pricing policy and bounded API request limits','publish quote API disabled and scoped IAM; verify live authorization and resources',
   'publish order candidate OFF after revision/hash comparison; verify existing discounts and authentication','run synthetic Cognito/Gateway/DynamoDB tests and safe rollback',
   'coordinate activation with compatible checkout build'],
  blockers:['local order-unit reader fixes require coordinated consumer deployment before quote activation','explicit per-customer quote quota (1..120/minute) and aggregate API concurrency limits require configuration','quote table and Mapbox credential are not provisioned/verified','approved pricing policy and rate limits need operational verification',
   'scoped IAM and live deletion guards need verification','live package candidates require synthetic integration, revision recheck and deployment approval',
   'full SAM lint retains conditional API warning W1028','retention, backup restore and real-device checkout validation remain required']};
 manifest.artifactSha256=Object.fromEntries(fs.readdirSync(outputDirectory).filter(n=>fs.statSync(path.join(outputDirectory,n)).isFile()).sort().map(n=>[n,sha256(fs.readFileSync(path.join(outputDirectory,n)))]));
 json('manifest.json',manifest);
 return manifest;
}
module.exports={prepare,readTemplate};
if(require.main===module){try{
 const args=process.argv.slice(2);if(args.length!==3)throw Error('EXPECTED_INSPECTION_LIVE_DIRECTORY_NEW_OUTPUT_DIRECTORY');
 const r=prepare({inspectionFile:args[0],liveDirectory:args[1],outputDirectory:args[2]});
 console.log(JSON.stringify({cloudWrites:r.cloudWrites,activationReady:r.activationReady,functions:Object.keys(r.functions),outputDirectory:args[2]}));
}catch(e){console.error(e.message);process.exitCode=1;}}
