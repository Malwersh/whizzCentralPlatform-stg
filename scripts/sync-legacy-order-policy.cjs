'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),bytes=fs.readFileSync(path.join(root,'backend/order-service/legacy-order-policy.js'));
for(const file of ['../wizzuser-stg/backend/src/functions/shared/legacy-order-policy.js','../whizzMerchants-stg/backend/functions/shared/legacy-order-policy.js','../whizzDrivers-stg/backend/legacy-order-policy.js','lambda/WaveSystem_HandleDriverAccept/legacy-order-policy.js']){
 const p=path.resolve(root,file);if(process.argv.includes('--check')){if(!fs.existsSync(p)||!bytes.equals(fs.readFileSync(p)))throw Error('LEGACY_ORDER_POLICY_OUT_OF_SYNC: '+file);}else fs.writeFileSync(p,bytes);
}
