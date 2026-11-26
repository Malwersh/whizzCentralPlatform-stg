'use strict';const fs=require('fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const check=process.argv.includes('--check');
const output=(file,b)=>{if(check){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(Buffer.from(b)))throw Error('RUNTIME_DRIFT:'+file);}else fs.writeFileSync(file,b);};
output('backend/staff-service/order-exception-settings-contract.js',esbuild.buildSync({entryPoints:['backend/wallet-service/src/orderExceptionSettings.ts'],bundle:true,platform:'node',target:'node20',write:false,external:['@aws-sdk/lib-dynamodb']}).outputFiles[0].contents);
