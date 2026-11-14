'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),check=process.argv.includes('--check');
const targets=['backend/staff-service','../wizzuser-stg/backend/src/functions/shared','../whizzMerchants-stg/backend/functions/shared'];
for(const name of ['discount-contract.js','discount-engine.js'])for(const target of targets){const content=fs.readFileSync(path.join(root,'backend/src/utils',name)),file=path.join(root,target,name);if(check){if(!fs.existsSync(file)||!content.equals(fs.readFileSync(file)))throw Error('DISCOUNT_RUNTIME_DRIFT '+file);}else fs.writeFileSync(file,content);}
console.log(JSON.stringify({discountRuntimeCopies:targets.length*2,checkOnly:check}));
