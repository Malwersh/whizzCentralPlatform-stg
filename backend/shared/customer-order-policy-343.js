'use strict';
const {createHash}=require('node:crypto');
const source=require('./customer-order-policy-343.json');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const copy=v=>JSON.parse(JSON.stringify(v));
const digest=createHash('sha256').update(JSON.stringify(canonical(source))).digest('hex');
function document(){return {...copy(source),digest};}
function pin(){return {policyId:source.policyId,version:source.version,digest};}
function check(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='digest,policyId,version'||JSON.stringify(canonical(value))!==JSON.stringify(canonical(pin())))throw Object.assign(Error('CUSTOMER_POLICY_CHANGED'),{statusCode:409});
}
function record(value,{subjectId,createdAt,commercialDigest}){
 if(value===undefined)return {status:'NOT_RECORDED_BY_CLIENT',document:document()};
 check(value);
 if(typeof subjectId!=='string'||!subjectId||typeof commercialDigest!=='string'||!/^[a-f0-9]{64}$/.test(commercialDigest)||!Number.isFinite(Date.parse(createdAt)))throw Object.assign(Error('CUSTOMER_POLICY_UNAVAILABLE'),{statusCode:503});
 return {status:'ACKNOWLEDGED',subjectId,recordedAt:createdAt,commercialDigest,...pin(),document:document()};
}
module.exports={document,pin,check,record};
