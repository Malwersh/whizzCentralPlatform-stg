'use strict';
// Package the merchant authorization contract into the standalone staff Lambda.
// Run with --check before packaging; normal invocation refreshes the artifact.
const fs=require('node:fs'),path=require('node:path');
for(const file of ['staff-permission-policy.js','staff-capabilities.js']){
 const source=path.resolve(__dirname,'../../whizzMerchants-stg/backend/merchant-platform',file);
 const destination=path.resolve(__dirname,'../backend/staff-service',file);
 const bytes=fs.readFileSync(source);
 if(process.argv.includes('--check')){if(!fs.readFileSync(destination).equals(bytes))throw Error('STAFF_POLICY_CONTRACT_OUT_OF_SYNC: '+file);}else fs.writeFileSync(destination,bytes);
}
