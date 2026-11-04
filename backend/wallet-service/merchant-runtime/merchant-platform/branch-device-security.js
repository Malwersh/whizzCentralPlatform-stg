'use strict';
const {randomBytes, scryptSync, timingSafeEqual, createHash}=require('node:crypto');
const fail=(code,status=403)=>{throw Object.assign(Error(code),{status});};
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
function digestPin(pin,salt){if(typeof pin!=='string'||!/^\d{6}$/.test(pin))fail('INVALID_PIN',400);return scryptSync(pin,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024}).toString('hex');}
function pinRecord(pin){const salt=secret();return {salt,digest:digestPin(pin,salt)};}
function checkPin(pin,record){const candidate=digestPin(pin,record.salt);return timingSafeEqual(Buffer.from(candidate,'hex'),Buffer.from(record.digest,'hex'));}
function checkSecret(token,digest){return typeof token==='string'&&token.length<1024&&typeof digest==='string'&&hash(token)===digest;}
function activeDevice(d,token,now){if(!d||d.status!=='ACTIVE'||d.expiresAt<=now||!checkSecret(token,d.tokenHash))fail('DEVICE_REVOKED',401);return d;}
function activeSession(s,token,d,m,now){if(!s||s.status!=='ACTIVE'||s.expiresAt<=now||s.deviceId!==d.deviceId||s.deviceVersion!==d.version||s.businessId!==d.businessId||!checkSecret(token,s.tokenHash))fail('SESSION_REVOKED',401);if(!m||m.status!=='ACTIVE'||m.version!==s.membershipVersion||m.subjectId!==s.subjectId||m.businessId!==d.businessId||m.ownerId!==d.ownerId)fail('MEMBERSHIP_REVOKED',403);return s;}
module.exports={fail,hash,secret,pinRecord,checkPin,checkSecret,activeDevice,activeSession};
