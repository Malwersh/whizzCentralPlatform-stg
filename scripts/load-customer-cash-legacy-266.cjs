require('./load-return-alternative-custody-candidate-265.cjs');
const runtime=require('/private/tmp/customer-cash-266/candidate-runtime/order-exception-runtime-229'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const mapDb=db=>({send:c=>{const kind=c.constructor.name.replace(/\d+$/,'');return db.send(sdk[kind]&&!(c instanceof sdk[kind])?new sdk[kind](c.input):c);}});
const file=require.resolve('../backend/wallet-service/dist/codReturn');require(file);require.cache[file].exports.createStagingCodReturn=options=>runtime.createStagingCodReturn({...options,db:mapDb(options.db)});
