'use strict';
// Offline testing only: execute packaged delegates with the real financial fixtures.
const Module=require('node:module'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),p=path.join(root,'backend/.tmp/admin-dispatch-retry-298');
const sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb');
const runtime=require(path.join(p,'admin-retry-runtime-298.js'));
const files=['dispatchCycle','dispatchCandidates','dispatchWaveExecutor','dispatchRestartStart','dispatchReviewExecutor','dispatchReviewHost','driverFinancialWave','driverOfferStore','driverOfferAcceptance','financialOfferDelivery','financialSearch','codFlowContext','codReassignment','codCompletion','fullCashCompletion','codIntegration','cancellationCompensation','returnCustody','driverQualityReview','driverQualityAppeal','driverTimingReview','merchantSettlementPreview','merchantSettlementBatch'];
function normalize(options){if(options?.send&&!options.db)return {send:c=>{const type=c.constructor.name.replace(/\d+$/,'');return options.send(c instanceof sdk[type]?c:new sdk[type](c.input));}};if(!options?.db)return options;return {...options,db:{send:c=>{const type=c.constructor.name.replace(/\d+$/,'');if(!sdk[type])throw Error('UNKNOWN_COMMAND '+type);return options.db.send(c instanceof sdk[type]?c:new sdk[type](c.input));}}};}
for(const file of files){const id=require.resolve('../backend/wallet-service/dist/'+file),old=require(id),next={...old};for(const name of Object.keys(old))if(runtime[name])next[name]=(...args)=>runtime[name](normalize(args[0]),...args.slice(1));require.cache[id].exports=next;}
