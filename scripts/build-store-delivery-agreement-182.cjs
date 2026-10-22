'use strict';
// Reuse the deployed host's actual AWS document command constructors. This
// avoids loading a second AWS SDK into 128 MB customer Lambdas.
const fs=require('fs'),esbuild=require('../backend/wallet-service/node_modules/esbuild');
const p='/private/tmp/store-agreement-182';
esbuild.buildSync({entryPoints:['backend/wallet-service/src/storeDeliveryAgreementRuntime.ts'],bundle:true,platform:'node',target:'node20',keepNames:true,external:['@aws-sdk/lib-dynamodb'],outfile:p+'/agreement-runtime182.js'});
let source=fs.readFileSync(p+'/agreement-runtime182.js','utf8');
if(!source.includes('require("@aws-sdk/lib-dynamodb")'))throw Error('SDK_IMPORT_MISSING');
source=source.replaceAll('require("@aws-sdk/lib-dynamodb")','require("./agreement-sdk182.js")');fs.writeFileSync(p+'/agreement-runtime182.js',source);
fs.writeFileSync(p+'/agreement-sdk182.js',`'use strict';
let constructors;
exports.bind = value => {
  if(!value||['GetCommand','QueryCommand','TransactWriteCommand'].some(k=>typeof value[k]!=='function'))throw Error('AGREEMENT_HOST_SDK_REQUIRED');
  constructors=value;
};
for(const name of ['GetCommand','QueryCommand','TransactWriteCommand'])exports[name]=function(input){
  if(!constructors)throw Error('AGREEMENT_HOST_SDK_REQUIRED');
  return new constructors[name](input);
};
`);
console.log('Agreement runtime built without a second AWS SDK:',Buffer.byteLength(source),'bytes');
