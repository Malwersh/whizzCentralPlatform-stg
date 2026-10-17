const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path'),{EventEmitter}=require('node:events');
const {createWaveOfferTransport}=require('../../../lambda/WaveSystem_StartWave/wave-offer-transport');
test('shared existing transport sends the exact message and internal-key payload without repricing',async()=>{
 const calls=[],message={offer:{deliveryFee:0,tip:1500,expiresAt:'fixed'}},payload={offerId:'id',dispatchMessageDigest:'hash'};
 const transport=createWaveOfferTransport({api:{postToConnection:q=>({promise:async()=>calls.push(q)})},notificationsBase:'https://example.invalid/staging/',internalKey:'test-only',request:async(...args)=>{calls.push(args);return {statusCode:200,body:'ok'};}});
 await transport.postSocket('current-connection',message);await transport.postPush(payload);assert.equal(calls[0].ConnectionId,'current-connection');assert.deepEqual(JSON.parse(calls[0].Data),message);assert.equal(calls[1][0],'https://example.invalid/staging/push/send/wave-offer');assert.equal(calls[1][1]['x-internal-key'],'test-only');assert.equal(calls[1][2],payload);assert.equal(calls[1][3],3000);
});
test('missing existing notification configuration reports skipped without fabricating success',async()=>{
 const transport=createWaveOfferTransport({api:{},notificationsBase:'',internalKey:'',request:()=>{throw Error('must not call');}});assert.equal((await transport.postPush({})).skipped,true);
});
test('HTTP transport rejects insecure endpoints and bounds response bytes and timeout without exposing request contents',async()=>{
 const req=new EventEmitter(),response=new EventEmitter();let config,sent,deadline;
 req.setTimeout=(ms,fn)=>{deadline={ms,fn};};req.destroy=e=>req.emit('error',e);req.end=data=>{sent=data;};response.statusCode=503;response.destroy=()=>{};
 const mod={exports:{}};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../../../lambda/WaveSystem_StartWave/wave-offer-transport.js'),'utf8'),{module:mod,Buffer,URL,require:n=>{assert.equal(n,'https');return {request:(q,fn)=>{config=q;fn(response);return req;}};}});
 await assert.rejects(mod.exports.postJson('http://example.invalid',{},{}),/HTTPS_ENDPOINT_REQUIRED/);
 const pending=mod.exports.postJson('https://example.invalid:8443/path?x=y',{}, {tip:1500},3000);assert.equal(config.port,'8443');assert.equal(config.path,'/path?x=y');assert.equal(sent,'{"tip":1500}');assert.equal(deadline.ms,3000);response.emit('data','large'.repeat(14000));await assert.rejects(pending,/PUSH_RESPONSE_TOO_LARGE/);
});
