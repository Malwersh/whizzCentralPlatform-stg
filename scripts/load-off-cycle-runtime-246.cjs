'use strict';
const api=require('../backend/staff-service/settlement-runtime'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const wrap=f=>options=>f({...options,db:{send:c=>{const kind=c.constructor.name.replace(/\d+$/,'');return options.db.send(sdk[kind]&&!(c instanceof sdk[kind])?new sdk[kind](c.input):c);}}});
for(const [file,name]of [['merchantStatementsAdmin','createMerchantStatementsAdmin'],['merchantPeriodCollection','createMerchantPeriodCollection'],['merchantSettlementBatch','createMerchantSettlementBatchService']]){const id=require.resolve('../backend/wallet-service/dist/'+file);require(id);require.cache[id].exports[name]=wrap(api[name]);}
