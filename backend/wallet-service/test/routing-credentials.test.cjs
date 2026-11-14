const {test}=require('node:test');
const assert=require('node:assert/strict');
const {GetSecretValueCommand}=require('@aws-sdk/client-secrets-manager');
const {createMapboxSecretReader,createStagingSecretDeliveryRouting}=require('../dist/routingCredentials');
const {createMapboxRoadRouter}=require('../dist/roadRouting');
const secretArn='arn:aws:secretsmanager:us-east-1:699561669180:secret:wizz/staging/maps/mapbox-Ab1234';
const token='pk.testPayload.testSignature';
const response=()=>({ARN:secretArn,VersionStages:['AWSCURRENT'],SecretString:JSON.stringify({accessToken:token})});
const make=(send=async()=>response(),extra={})=>createMapboxSecretReader({secrets:{send},secretArn,accountId:'699561669180',region:'us-east-1',timeoutMs:500,...extra});
const rejected=p=>assert.rejects(p,e=>e.code==='ROUTING_NOT_CONFIGURED'&&e.message==='ROUTING_NOT_CONFIGURED'&&!e.cause);

test('credentials use exact ARN and AWSCURRENT; token only returns to the trusted caller',async()=>{
 let seen;
 const read=make(async(command,options)=>{seen={command,options};return response();});
 assert.equal(await read(),token);
 assert.ok(seen.command instanceof GetSecretValueCommand);
 assert.deepEqual(seen.command.input,{SecretId:secretArn,VersionStage:'AWSCURRENT'});
 assert.ok(seen.options.abortSignal instanceof AbortSignal);
});
test('cross-account, cross-region and incomplete references fail before any SDK call',()=>{
 let calls=0;
 for(const extra of [{secretArn:'wizz/staging/maps/mapbox'},{accountId:'031857856164'},{region:'eu-west-1'},
  {secretArn:secretArn+':suffix'},{secretArn:secretArn+':secret:other'},{secretArn:secretArn+'\n'},{timeoutMs:0},{timeoutMs:10001}]) {
  assert.throws(()=>make(async()=>{calls++;return response();},extra),e=>e.code==='ROUTING_NOT_CONFIGURED');
 }
 assert.equal(calls,0);
});
test('reject wrong secret, old version, binary, malformed and open-ended schemas',async()=>{
 for(const patch of [{ARN:secretArn+'other'},{VersionStages:['AWSPREVIOUS']},{VersionStages:undefined},
  {SecretBinary:Buffer.from(token)},{SecretString:undefined},{SecretString:token},{SecretString:'null'},
  {SecretString:'[]'},{SecretString:JSON.stringify({accessToken:token,debug:true})},
  {SecretString:JSON.stringify({accessToken:token+'\n'})},{SecretString:JSON.stringify({accessToken:'placeholder'})},
  {SecretString:JSON.stringify({accessToken:'pk.'+'x'.repeat(8200)+'.s'})}]) {
  await rejected(make(async()=>({...response(),...patch}))());
 }
});
test('rotation is read afresh; permission or lookup failure never returns a cached token',async()=>{
 let n=0;
 const read=make(async()=>{
  if(++n===3)throw Error('provider diagnostic includes '+token);
  return {...response(),SecretString:JSON.stringify({accessToken:n===1?token:'pk.newPayload.newSignature'})};
 });
 assert.equal(await read(),token);
 assert.equal(await read(),'pk.newPayload.newSignature');
 await rejected(read());
});
test('credential deadline aborts SDK even if transport stalls; failure is sanitized',async()=>{
 let signal;
 const read=make(async(_command,options)=>{signal=options.abortSignal;return new Promise(()=>{});},{timeoutMs:100});
 await rejected(read());
 assert.equal(signal.aborted,true);
});
test('Mapbox request cannot run when credential read fails',async()=>{
 let calls=0;
 const router=createMapboxRoadRouter({getAccessToken:make(async()=>{throw Error(token);}),profile:'driving',
  ttlSeconds:120,timeoutMs:1000,fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 await rejected(router.getRoute({latitude:33.31,longitude:44.36},{latitude:33.32,longitude:44.37}));
 assert.equal(calls,0);
});
test('staging factory rejects dev secret and a credential deadline outside route deadline',()=>{
 const config={db:{send:async()=>{}},secrets:{send:async()=>response()},secretArn,profile:'driving',ttlSeconds:120,
  timeoutMs:1000,credentialTimeoutMs:500};
 assert.throws(()=>createStagingSecretDeliveryRouting({...config,secretArn:secretArn.replace('699561669180','031857856164')}),e=>e.code==='ROUTING_NOT_CONFIGURED');
 assert.throws(()=>createStagingSecretDeliveryRouting({...config,credentialTimeoutMs:1000}),e=>e.code==='ROUTING_NOT_CONFIGURED');
 assert.equal(typeof createStagingSecretDeliveryRouting(config).getDeliveryRoute,'function');
});
test('combined factory checks live region hierarchy before secrets and provider, then rechecks coverage',async()=>{
 const levels=['country','governorate','district','zone'];let active=true,secretReads=0,providerCalls=0;
 const db={send:async command=>{
  const q=command.input;
  if(q.IndexName)return {Items:[{h3_cell:q.ExpressionAttributeValues[':cell'],regionId:'zone'}]};
  const regionId=q.Key.regionId;
  if(q.TableName==='WizzCentral_RegionsDerived_staging')return {Item:{regionId,effective_is_active:1}};
  const level=levels.indexOf(regionId);
  return {Item:{regionId,level,parent_id:level?levels[level-1]:'ROOT',is_active:active?1:0,
   ...(level===3?{geometry:{type:'Polygon',coordinates:[[[44.3,33.2],[44.5,33.2],[44.5,33.4],[44.3,33.4],[44.3,33.2]]]}}:{})}};
 }};
 const config={db,secrets:{send:async()=>{secretReads++;return response();}},secretArn,profile:'driving',
  ttlSeconds:120,timeoutMs:1000,credentialTimeoutMs:500,
  fetchImpl:async url=>{providerCalls++;assert.equal(url.searchParams.get('access_token'),token);
   return new Response(JSON.stringify({code:'Ok',routes:[{distance:510.1,duration:110.2}]}));}};
 const origin={latitude:33.3152,longitude:44.3661},destination={latitude:33.3105,longitude:44.375};
 const result=await createStagingSecretDeliveryRouting(config).getDeliveryRoute(origin,destination);
 assert.equal(result.route.distanceMeters,511);assert.equal(result.route.durationSeconds,111);
 assert.equal(result.originCoverage.regionId,'zone');assert.ok(!JSON.stringify(result).includes(token));
 active=false;
 await assert.rejects(createStagingSecretDeliveryRouting(config).getDeliveryRoute(origin,destination),e=>e.code==='OUTSIDE_COVERAGE');
 assert.equal(secretReads,1);assert.equal(providerCalls,1);
 active=true;
 await assert.rejects(createStagingSecretDeliveryRouting({...config,fetchImpl:async()=>{active=false;return new Response(JSON.stringify({code:'Ok',routes:[{distance:10,duration:1}]}));}}).getDeliveryRoute(origin,destination),e=>e.code==='OUTSIDE_COVERAGE');
});
