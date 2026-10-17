'use strict';
// Offline environment agreement check, not a publisher or financial authorization.
const fs=require('node:fs');
const {readFinanceRollout}=require('../backend/wallet-service/dist/financeRollout');
const {quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
const FUNCTIONS=['WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging','WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverAccept','WaveSystem_HandleDriverReject','DriversApi-staging','staging-driver-financial-accept','staging-cod-integration','staging-wizz-staff-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer'];
function preserveDrainingScopes(beforeEnv,afterEnv){
 const old=readFinanceRollout(beforeEnv),next=readFinanceRollout(afterEnv);
 const members=s=>quoteHash({id:s.id,version:s.version,orders:s.orders,drivers:s.drivers});
 for(const s of old.scopes){const found=next.scopes.find(n=>n.id===s.id&&n.version===s.version);if(!found||members(s)!==members(found)||s.mode==='DRAIN'&&found.mode!=='DRAIN')throw Error('DRAINING_SCOPE_REMOVAL_REQUIRES_SEPARATE_TERMINAL_AUDIT');}
}
function check(manifest){
 if(manifest.account!=='699561669180'||manifest.region!=='us-east-1'||!Array.isArray(manifest.functions)||manifest.functions.length!==FUNCTIONS.length)throw Error('EXACT_STAGING_FUNCTION_SET_REQUIRED');
 const seen=new Set(),digests=new Set();
 for(const f of manifest.functions){if(!FUNCTIONS.includes(f.name)||seen.has(f.name)||f.arn!==`arn:aws:lambda:us-east-1:699561669180:function:${f.name}`)throw Error('EXACT_STAGING_FUNCTION_SET_REQUIRED');seen.add(f.name);readFinanceRollout(f.env);digests.add(f.env.FINANCE_ROLLOUT_SHA256);}
 if(digests.size!==1)throw Error('FINANCE_ROLLOUT_ENVIRONMENT_DRIFT');
 return {functions:seen.size,scopeDigest:[...digests][0],scopeAgreement:true,activationAuthorized:false};
}
module.exports={FUNCTIONS,check,preserveDrainingScopes};
if(require.main===module){try{console.log(JSON.stringify(check(JSON.parse(fs.readFileSync(process.argv[2],'utf8')))));}catch(e){console.error(e.message);process.exitCode=1;}}
