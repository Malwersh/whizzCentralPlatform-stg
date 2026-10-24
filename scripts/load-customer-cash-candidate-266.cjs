const runtime=require('/private/tmp/customer-cash-266/candidate-runtime/customer-cash-runtime-266'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const mapDb=db=>({send:c=>{const kind=c.constructor.name.replace(/\d+$/,'');return db.send(sdk[kind]&&!(c instanceof sdk[kind])?new sdk[kind](c.input):c);}});
for(const name of ['customerCashCase','customerCashReview']){
 const id=require.resolve('../backend/wallet-service/dist/'+name);require(id);
 for(const key of Object.keys(require.cache[id].exports))if(runtime[key])require.cache[id].exports[key]=key==='createCustomerCashCase'?options=>runtime[key]({...options,db:mapDb(options.db)}):runtime[key];
}
const runtimeId=require.resolve('../backend/wallet-service/dist/customerCashRuntime266');require(runtimeId);
require.cache[runtimeId].exports.createCustomerCashRuntime=options=>runtime.createCustomerCashRuntime({...options,db:mapDb(options.db)});
require.cache[runtimeId].exports.guardCashReviewReturnDb=db=>runtime.guardCashReviewReturnDb(mapDb(db));
