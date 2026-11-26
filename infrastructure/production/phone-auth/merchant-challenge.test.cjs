const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHandler, PREFIX, TTL} = require('./merchant-challenge');
function setup() {
  let now = 1000, sends = 0, seq = 0, next = 0, count = 0;
  const rows = new Map();
  const deps = {
    poolId: 'production-pool', now: () => now, id: () => String(++seq), code: () => '123456',
    config: async () => ({apiKey: 'test-provider-key', hmacKey: 'test-only-hmac'}),
    get: async id => rows.has(id) ? structuredClone(rows.get(id)) : undefined,
    reserve: async (row, time) => {
      if (time < next || count >= 10) throw Error('Rate limited');
      next = time + 60; count++; rows.set(row.id, structuredClone(row));
    },
    send: async () => {sends++;},
    invalidate: async id => {rows.get(id).invalid = true;},
    attempt: async (row, scope, time, correct) => {
      const live = rows.get(row.id);
      if (live.used || live.invalid || live.expiresAt <= time || live.attempts !== row.attempts || live.attempts >= 3 || live.subject !== scope.subject || live.poolId !== scope.poolId) return false;
      live.attempts++; if (correct) live.used = true; return true;
    },
  };
  const event = (trigger, request = {}, subject = 'merchant-1') => ({userPoolId: 'production-pool', userName: subject,
    triggerSource: trigger + '_Authentication', request: {userAttributes: {phone_number: '+9647800868280'}, ...request}, response: {}});
  return {deps, rows, event, handler: e => createHandler(deps)(e), tick: t => {now += t;}, sends: () => sends};
}
async function start(s) {return s.handler(s.event('CreateAuthChallenge'));}
async function verify(s, challenge, answer = '123456', subject) {
  return s.handler(s.event('VerifyAuthChallengeResponse', {privateChallengeParameters: challenge.response.privateChallengeParameters, challengeAnswer: answer}, subject));
}
test('metadata is opaque and code is never stored in records or public parameters', async () => {
  const s = setup(), e = await start(s); assert.ok(e.response.challengeMetadata.startsWith(PREFIX));
  assert.equal(JSON.stringify([...s.rows.values()]).includes('123456'), false);
  assert.equal(JSON.stringify(e).includes('123456'), false); assert.equal(s.sends(), 1);
});
test('correct code succeeds once; replay fails', async () => {
  const s = setup(), e = await start(s); assert.equal((await verify(s,e)).response.answerCorrect,true);
  assert.equal((await verify(s,e)).response.answerCorrect,false);
});
test('concurrent correct submissions consume the challenge only once', async () => {
  const s = setup(), e = await start(s); const results = await Promise.all([verify(s,e),verify(s,e)]);
  assert.equal(results.filter(x => x.response.answerCorrect).length,1);
});
test('three wrong attempts exhaust the challenge', async () => {
  const s = setup(), e = await start(s);
  for(let i=0;i<3;i++) assert.equal((await verify(s,e,'000000')).response.answerCorrect,false);
  assert.equal((await verify(s,e)).response.answerCorrect,false);
});
test('expired code fails even before physical TTL deletion', async () => {
  const s = setup(), e = await start(s); s.tick(TTL); assert.equal((await verify(s,e)).response.answerCorrect,false);
});
test('challenge is bound to merchant and pool', async () => {
  const s = setup(), e = await start(s); assert.equal((await verify(s,e,'123456','merchant-2')).response.answerCorrect,false);
  const wrong = s.event('CreateAuthChallenge');wrong.userPoolId='other';await assert.rejects(s.handler(wrong));
});
test('retry preserves expiry and does not send another SMS', async () => {
  const s=setup(), e=await start(s);await verify(s,e,'000000');s.tick(10);
  const retry=await s.handler(s.event('CreateAuthChallenge',{session:[{challengeName:'CUSTOM_CHALLENGE',challengeResult:false,challengeMetadata:e.response.challengeMetadata}]}));
  assert.deepEqual(retry.response.privateChallengeParameters,e.response.privateChallengeParameters);
  assert.equal(retry.response.publicChallengeParameters.expiresAt,e.response.publicChallengeParameters.expiresAt);assert.equal(s.sends(),1);
});
test('failed provider delivery invalidates challenge', async () => {
  const s=setup();s.deps.send=async()=>{throw Error('provider failure');};await assert.rejects(start(s));
  const row=[...s.rows.values()][0];assert.equal(row.invalid,true);
  assert.equal((await verify(s,{response:{privateChallengeParameters:{id:row.id}}})).response.answerCorrect,false);
});
test('cooldown and daily limit prevent repeated SMS',async()=>{
  const s=setup();await start(s);await assert.rejects(start(s));
  for(let i=1;i<10;i++){s.tick(61);await start(s);}s.tick(61);await assert.rejects(start(s));assert.equal(s.sends(),10);
});
test('unknown user and non-Iraqi phone cannot start challenge',async()=>{
  const s=setup();await assert.rejects(s.handler(s.event('CreateAuthChallenge',{userNotFound:true})));
  await assert.rejects(s.handler(s.event('CreateAuthChallenge',{userAttributes:{phone_number:'+14025551234'}})));assert.equal(s.sends(),0);
});
test('missing production provider configuration fails before sending',async()=>{
  const s=setup();s.deps.config=async()=>({});await assert.rejects(start(s));assert.equal(s.sends(),0);assert.equal(s.rows.size,0);
});
test('token issuance requires successful scoped custom challenge history',async()=>{
  const s=setup();const failed=await s.handler(s.event('DefineAuthChallenge',{session:[{challengeName:'PASSWORD_VERIFIER',challengeResult:true}]}));assert.equal(failed.response.issueTokens,false);assert.equal(failed.response.failAuthentication,true);
  const passed=await s.handler(s.event('DefineAuthChallenge',{session:[{challengeName:'CUSTOM_CHALLENGE',challengeMetadata:PREFIX+'1',challengeResult:true}]}));assert.equal(passed.response.issueTokens,true);
  const exhausted=await s.handler(s.event('DefineAuthChallenge',{session:Array(3).fill({challengeName:'CUSTOM_CHALLENGE',challengeMetadata:PREFIX+'1',challengeResult:false})}));assert.equal(exhausted.response.failAuthentication,true);
});

test('enrollment proof completes custom auth without sending a second message and cannot replay',async()=>{
  const s=setup();let used=false;
  s.deps.proofs={pending:async()=>({id:'ENROLL_PROOF#test',expiresAt:1090}),verify:async(id,identity,answer)=>{
    if(used || id!=='ENROLL_PROOF#test' || identity.sub!=='sub-1' || answer!=='proof-answer')return false;
    used=true;return true;
  }};
  const attrs={sub:'sub-1',phone_number:'+9647800868280',phone_number_verified:'true'};
  const created=await s.handler(s.event('CreateAuthChallenge',{userAttributes:attrs}));
  assert.equal(created.response.publicChallengeParameters.kind,'verified-phone');assert.equal(s.sends(),0);
  const request={userAttributes:attrs,privateChallengeParameters:created.response.privateChallengeParameters,challengeAnswer:'proof-answer'};
  assert.equal((await s.handler(s.event('VerifyAuthChallengeResponse',request))).response.answerCorrect,true);
  assert.equal((await s.handler(s.event('VerifyAuthChallengeResponse',request))).response.answerCorrect,false);
  const done=await s.handler(s.event('DefineAuthChallenge',{session:[{challengeName:'CUSTOM_CHALLENGE',challengeMetadata:'ENROLL_PROOF#test',challengeResult:true}]}));
  assert.equal(done.response.issueTokens,true);assert.equal(s.sends(),0);
});
test('foreign app client is rejected before proof lookup or sending',async()=>{
  const s=setup();s.deps.clientId='expected';let reads=0;s.deps.proofs={pending:async()=>{reads++;}};
  const e=s.event('CreateAuthChallenge');e.callerContext={clientId:'foreign'};
  await assert.rejects(s.handler(e));assert.equal(reads,0);assert.equal(s.sends(),0);
});
test('unverified identity cannot redeem enrollment proof',async()=>{
  const s=setup();let reads=0;s.deps.proofs={verify:async()=>{reads++;return true;}};
  const checked=await s.handler(s.event('VerifyAuthChallengeResponse',{privateChallengeParameters:{id:'ENROLL_PROOF#test'},challengeAnswer:'answer'}));
  assert.equal(checked.response.answerCorrect,false);assert.equal(reads,0);
});
