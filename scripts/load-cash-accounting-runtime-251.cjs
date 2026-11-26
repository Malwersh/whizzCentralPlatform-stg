'use strict';
const runtime=require('../backend/staff-service/settlement-runtime'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const id=require.resolve('../backend/wallet-service/dist/merchantPayoutApi');require(id);require.cache[id].exports.createMerchantPayoutApi=options=>runtime.createMerchantPayoutApi({...options,db:{send:c=>{const kind=c.constructor.name.replace(/\d+$/,'');return options.db.send(sdk[kind]&&!(c instanceof sdk[kind])?new sdk[kind](c.input):c);}}});
