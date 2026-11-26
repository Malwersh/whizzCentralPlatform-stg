'use strict';
const crypto = require('node:crypto');
const TTL = 180;
const MAX_ATTEMPTS = 3;
const PREFIX = 'OTPREF#';
const PROOF_PREFIX = 'ENROLL_PROOF#';
const digest = (key, pool, subject, id, code) => crypto.createHmac('sha256', key)
  .update(JSON.stringify([pool, subject, id, code])).digest('hex');

function createHandler(deps) {
  return async event => {
    if (!deps.poolId || event.userPoolId !== deps.poolId ||
        (deps.clientId && event.callerContext?.clientId !== deps.clientId)) throw Error('Invalid authentication pool');
    event.response = event.response || {};
    const request = event.request || {};
    const session = request.session || [];
    if (request.userNotFound || !event.userName) {
      if (event.triggerSource === 'DefineAuthChallenge_Authentication') {
        event.response = { issueTokens: false, failAuthentication: true };
        return event;
      }
      throw Error('Unable to authenticate');
    }
    if (event.triggerSource === 'DefineAuthChallenge_Authentication') {
      const last = session.at(-1);
      const validHistory = session.every(x => x.challengeName === 'CUSTOM_CHALLENGE' &&
        typeof x.challengeMetadata === 'string' && (x.challengeMetadata.startsWith(PREFIX) ||
          (deps.proofs && x.challengeMetadata.startsWith(PROOF_PREFIX))));
      const passed = validHistory && last?.challengeResult === true && session.length <= MAX_ATTEMPTS;
      event.response = {issueTokens: Boolean(passed), failAuthentication: !validHistory || (!passed && session.length >= MAX_ATTEMPTS)};
      if (!event.response.issueTokens && !event.response.failAuthentication) event.response.challengeName = 'CUSTOM_CHALLENGE';
      return event;
    }
    const now = deps.now();
    const scope = {poolId: deps.poolId, subject: event.userName};
    const identity = {username:event.userName,sub:request.userAttributes?.sub,phone:request.userAttributes?.phone_number};
    if (deps.proofs && event.triggerSource === 'CreateAuthChallenge_Authentication' &&
        request.userAttributes?.phone_number_verified === 'true' && !session.length) {
      const proof = await deps.proofs.pending(identity);
      if (proof) {
        event.response.publicChallengeParameters = {kind:'verified-phone',expiresAt:String(proof.expiresAt)};
        event.response.privateChallengeParameters = {id:proof.id};
        event.response.challengeMetadata = proof.id;
        return event;
      }
    }
    if (deps.proofs && event.triggerSource === 'VerifyAuthChallengeResponse_Authentication' &&
        typeof request.privateChallengeParameters?.id === 'string' &&
        request.privateChallengeParameters.id.startsWith(PROOF_PREFIX)) {
      event.response.answerCorrect = false;
      if(request.userAttributes?.phone_number_verified !== 'true') return event;
      const config = await deps.config();
      event.response.answerCorrect = await deps.proofs.verify(request.privateChallengeParameters.id,identity,request.challengeAnswer,config.hmacKey);
      return event;
    }
    const valid = row => row && row.poolId === scope.poolId && row.subject === scope.subject &&
      row.expiresAt > now && row.used === false && row.invalid !== true && row.attempts < MAX_ATTEMPTS;
    if (event.triggerSource === 'CreateAuthChallenge_Authentication') {
      const phone = String(request.userAttributes?.phone_number || '');
      if (!/^\+9647\d{9}$/.test(phone)) throw Error('Invalid phone');
      let row;
      if (session.length) {
        const last = session.at(-1);
        if (session.length >= MAX_ATTEMPTS || last.challengeName !== 'CUSTOM_CHALLENGE' ||
            last.challengeResult !== false || !last.challengeMetadata?.startsWith(PREFIX)) throw Error('Challenge unavailable');
        row = await deps.get(last.challengeMetadata);
        if (!valid(row)) throw Error('Challenge unavailable');
      } else {
        const config = await deps.config();
        if (!config.apiKey || !config.hmacKey) throw Error('OTP configuration unavailable');
        const code = deps.code();
        if (!/^\d{6}$/.test(code)) throw Error('Invalid generated code');
        row = {...scope, id: PREFIX + deps.id(), phone, expiresAt: now + TTL, used: false, attempts: 0};
        row.digest = digest(config.hmacKey, scope.poolId, scope.subject, row.id, code);
        await deps.reserve(row, now); // Atomically reserve cooldown, daily cap, and challenge.
        try { await deps.send(phone, code, config.apiKey); }
        catch (_) { await deps.invalidate(row.id, scope); throw Error('Unable to deliver verification code'); }
      }
      event.response.publicChallengeParameters = {phone: phone.slice(0, 4) + '*******' + phone.slice(-3), expiresAt: String(row.expiresAt)};
      event.response.privateChallengeParameters = {id: row.id};
      event.response.challengeMetadata = row.id;
      return event;
    }
    if (event.triggerSource === 'VerifyAuthChallengeResponse_Authentication') {
      event.response.answerCorrect = false;
      const id = request.privateChallengeParameters?.id;
      if (typeof id !== 'string' || !id.startsWith(PREFIX)) return event;
      const row = await deps.get(id);
      if (!valid(row)) return event;
      const answer = String(request.challengeAnswer || '').trim();
      const config = await deps.config();
      if (!config.hmacKey) throw Error('OTP configuration unavailable');
      const expected = Buffer.from(String(row.digest), 'hex');
      const actual = Buffer.from(digest(config.hmacKey, scope.poolId, scope.subject, id, answer), 'hex');
      const correct = /^\d{6}$/.test(answer) && expected.length === 32 && crypto.timingSafeEqual(expected, actual);
      event.response.answerCorrect = await deps.attempt(row, scope, now, correct) && correct;
      return event;
    }
    throw Error('Unsupported authentication trigger');
  };
}
module.exports = {createHandler, digest, TTL, MAX_ATTEMPTS, PREFIX};
