'use strict';
// Core only: AWS adapter and deployment are deliberately separate acceptance gates.
const crypto=require('node:crypto');
const POOL='us-east-1_2sKZ4fGbZ',PURPOSE='merchant-enrollment',TTL=180,MAX=3;
const fail=code=>{throw Object.assign(Error(code),{code});};
const normalize=value=>{if(typeof value!=='string')fail('INVALID_PHONE');let p=value.trim().replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)>=0x6f0?0x6f0:0x660))).replace(/[\s()-]/g,'');if(/^009647\d{9}$/.test(p))p='+'+p.slice(2);if(/^07\d{9}$/.test(p))p='+964'+p.slice(1);if(/^7\d{9}$/.test(p))p='+964'+p;if(/^9647\d{9}$/.test(p))p='+'+p;if(!/^\+9647\d{9}$/.test(p))fail('INVALID_PHONE');return p;};
const hash=(key,row,code)=>crypto.createHmac('sha256',key).update(JSON.stringify([POOL,PURPOSE,row.phone,row.id,code])).digest('hex');
function createService(d){
 const configured=()=>{if(d.enabled!==true||d.poolId!==POOL)fail('ENROLLMENT_UNAVAILABLE');};
 const valid=(r,p,now)=>r&&r.poolId===POOL&&r.purpose===PURPOSE&&r.phone===p&&!r.used&&!r.invalid&&r.attempts<MAX&&r.expiresAt>now;
 return {
  async send(input,context){
   configured();const phone=normalize(input.phone),key=await d.config();if(!key.apiKey||!key.hmacKey)fail('PROVIDER_UNAVAILABLE');
   await d.assertPhoneOpen?.(phone);
   await d.assertPhoneAvailable(phone); // Includes live identity/lifecycle and duplicate checks.
   const now=d.now(),row={id:crypto.randomUUID(),poolId:POOL,purpose:PURPOSE,phone,expiresAt:now+TTL,attempts:0,used:false};
   const code=String(crypto.randomInt(0,1000000)).padStart(6,'0');row.digest=hash(key.hmacKey,row,code);
   // Adapter must atomically replace ACTIVE and reserve phone/IP/global budgets.
   await d.reserve(row,context);
   try{await d.deliver(phone,code,key.apiKey);}catch{await d.invalidate(row.id);fail('DELIVERY_FAILED');}
   return {sessionId:row.id,expiresIn:TTL};
  },
  async verify(input){
   configured();const phone=normalize(input.phone);
   if(typeof input.sessionId!=='string'||input.sessionId.length>100||typeof input.code!=='string'||!/^\d{6}$/.test(input.code))fail('INVALID_CHALLENGE');
   const row=await d.get(input.sessionId),now=d.now();
   if(!valid(row,phone,now)||!await d.isActive(phone,row.id))fail('CHALLENGE_EXPIRED');
   const key=await d.config();if(!key.hmacKey)fail('PROVIDER_UNAVAILABLE');
   const expected=Buffer.from(String(row.digest),'hex'),actual=Buffer.from(hash(key.hmacKey,row,input.code),'hex');
   const correct=expected.length===32&&crypto.timingSafeEqual(expected,actual);
   if(!correct){await d.attempt(row,now);fail('INVALID_CODE');}
   await d.assertPhoneOpen?.(phone);
   await d.assertPhoneAvailable(phone);
   const name=typeof input.name==='string'?input.name.trim():'';
   if(name.length<2||name.length>80||/[\u0000-\u001f]/.test(name))fail('NAME_REQUIRED');
   if(input.legalAccepted!==true||!input.legalAcceptance)fail('LEGAL_ACCEPTANCE_REQUIRED');
   const consent=await d.consent(input.legalAcceptance,'MERCHANT');
   // Single transaction must check ACTIVE, expiry, attempts, unused and legal pin.
   if(!await d.consume(row,now,consent))fail('CHALLENGE_EXPIRED');
   // Adapter must use deterministic phone ownership and recoverable AdminCreateUser,
   // never public SignUp or overwrite an existing identity/password.
   await d.assertPhoneOpen?.(phone);
   const identity=await d.provisionVerified({phone,name,challengeId:row.id,consent});
   if(identity?.poolId!==POOL||identity.phone!==phone||identity.phoneVerified!==true||!identity.sub)fail('IDENTITY_NOT_VERIFIED');
   await d.assertIdentityOpen(identity.sub);
   return await d.login(identity); // Scoped single-use proof; no wallet/branch approval.
  }
 };
}
module.exports={createService,POOL,PURPOSE,TTL,MAX,normalize};
