'use strict';
require('./load-cash-accounting-runtime-251.cjs');
const runtime=require('../backend/staff-service/settlement-runtime'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const id=require.resolve('../backend/wallet-service/dist/merchantPayoutDeviceAuthority');require(id);require.cache[id].exports.createMerchantDevicePayoutAuthority=options=>runtime.createMerchantDevicePayoutAuthority({...options,db:{send:c=>{const kind=c.constructor.name.replace(/\d+$/,'');return options.db.send(sdk[kind]&&!(c instanceof sdk[kind])?new sdk[kind](c.input):c);}}});
