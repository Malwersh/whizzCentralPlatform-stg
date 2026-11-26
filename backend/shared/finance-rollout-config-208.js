'use strict';
// Storage encoding only. Restore the exact historical scope bytes before any
// financial runtime loads; the original SHA-256 and admission policy stay intact.
const {gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
function restoreFinanceRolloutConfig(env=process.env){
 const raw=env.FINANCE_ROLLOUT_CONFIG;
 if(typeof raw!=='string'||!raw.startsWith('GZIP208:'))return false;
 const encoded=raw.slice(8);
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||encoded.length>16384)throw Error('FINANCE_ROLLOUT_ENCODING_INVALID');
 const bytes=Buffer.from(encoded,'base64');
 if(bytes.toString('base64')!==encoded)throw Error('FINANCE_ROLLOUT_ENCODING_INVALID');
 const decoded=gunzipSync(bytes,{maxOutputLength:65536}).toString('utf8');
 if(createHash('sha256').update(canonical(JSON.parse(decoded))).digest('hex')!==env.FINANCE_ROLLOUT_SHA256)throw Error('FINANCE_ROLLOUT_ENCODING_DIGEST_MISMATCH');
 env.FINANCE_ROLLOUT_CONFIG=decoded;return true;
}
module.exports={restoreFinanceRolloutConfig};
