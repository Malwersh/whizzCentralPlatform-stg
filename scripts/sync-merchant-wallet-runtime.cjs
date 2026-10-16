'use strict';
// Canonical merchant authentication is reused verbatim, never reimplemented here.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.resolve(root,'../whizzMerchants-stg/backend'),destination=path.join(root,'backend/wallet-service/merchant-runtime');
const files=['functions/auth/branch_devices.js','functions/auth/branch_device_status.js','functions/auth/branch_device_discounts.js','functions/auth/staff_policy_access.js',...['domain.js','branch-device-security.js','branch-profile-policy.js','staff-permission-policy.js','staff-capabilities.js','staff-legacy-grants.js'].map(n=>'merchant-platform/'+n)];
for(const file of files){const contents=fs.readFileSync(path.join(source,file)),target=path.join(destination,file);if(process.argv.includes('--check')){if(!fs.existsSync(target)||!contents.equals(fs.readFileSync(target)))throw Error('Merchant wallet runtime differs: '+file);}else{fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,contents);}}
// The financial authorizer's existing platform role snapshots share this source.
const roleData=JSON.stringify(require('../backend/staff-service/catalog').ROLES,null,2)+'\n';
for(const file of ['src/staff-roles.json','authorizer_lambda/staff-roles.json']){
 const target=path.join(root,'backend/wallet-service',file);
 if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==roleData)throw Error('Wallet role catalog differs: '+file);}
 else fs.writeFileSync(target,roleData);
}
