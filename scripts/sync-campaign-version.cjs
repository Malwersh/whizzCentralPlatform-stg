'use strict';
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'backend/src/utils/campaign-version.js'));
const targets=[path.join(root,'backend/staff-service/campaign-version.js'),path.join(root,'../whizzMerchants-stg/backend/functions/shared/campaign-version.js'),path.join(root,'../wizzuser-stg/backend/src/functions/shared/campaign-version.js')];
for(const file of targets){if(process.argv.includes('--check')){if(!fs.existsSync(file)||!source.equals(fs.readFileSync(file)))throw Error('CAMPAIGN_VERSION_COPY_DRIFT '+file);}else fs.writeFileSync(file,source);}
console.log(JSON.stringify({campaignVersionCopies:targets.length,checkOnly:process.argv.includes('--check')}));

const lock=fs.readFileSync(path.join(root,'backend/src/utils/shared-discount-lock.js'));for(const target of targets){const file=path.join(path.dirname(target),'shared-discount-lock.js');if(process.argv.includes('--check')){if(!fs.existsSync(file)||!lock.equals(fs.readFileSync(file)))throw Error('SHARING_LOCK_COPY_DRIFT '+file);}else fs.writeFileSync(file,lock);}
