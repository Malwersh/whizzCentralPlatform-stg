'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),assert=require('node:assert/strict'),Module=require('node:module');
const root=path.resolve(__dirname,'..'),r='/private/tmp/finance63';
const extras={driver:'module.exports.__probe={buildDriverOffer,prepareDriverOfferAcceptance,createStagingCodCompletion,prepareDriverOfferFinancialSnapshot,calculateDriverEarning,moneyFromMinor,toWholeIqdExact,allocateOrder};',writer:'module.exports.__probe={createStagingCommercialSource:require_orderCommercialSource().createStagingCommercialSource,money:require_money(),allocateOrder:require_orderAllocation().allocateOrder};',quote:'module.exports.__probe=require_runtime();'};
function load(k){const dir=r+'/probes/'+k;fs.mkdirSync(dir,{recursive:true});const name=k==='writer'?'functions/create-order/commercial-runtime.js':'index.js';const data=cp.execFileSync('python3',['-c','import zipfile,sys;sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))',r+'/'+k+'.candidate.zip',name],{maxBuffer:20000000}).toString();
 if(k==='driver')for(const n of ['money','deliveryPricing']){fs.mkdirSync(dir+'/pricing-runtime',{recursive:true});fs.copyFileSync(r+'/overlays/driver/pricing-runtime/'+n+'.js',dir+'/pricing-runtime/'+n+'.js');}
 if(k==='writer'){fs.mkdirSync(dir+'/shared',{recursive:true});fs.copyFileSync(root+'/backend/src/utils/campaign-version.js',dir+'/shared/campaign-version.js');}
 // The wrapper's existing relative shared path is resolved from the original functions/create-order location.
 const file=k==='writer'?dir+'/create-order/index.js':dir+'/index.js';fs.mkdirSync(path.dirname(file),{recursive:true});const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file)).concat(Module._nodeModulePaths(root));m._compile(data+'\n'+extras[k],file);return m.exports;
}
const writer=load('writer').__probe,driver=load('driver').__probe,quote=load('quote').__probe;
assert.equal(driver.toWholeIqdExact(driver.moneyFromMinor(317000)),317);assert.throws(()=>driver.toWholeIqdExact(driver.moneyFromMinor(317001)));
assert.equal(typeof quote.createStagingDeliveryQuotes,'function');assert.equal(typeof writer.createStagingCommercialSource,'function');
const baseline=require('../docs/finance-commercial-pricing-approval-59.json'),review=require('../docs/finance-commercial-pricing-proposal-58.json');
const context={branchId:'REVIEW_BRANCH',merchantId:'REVIEW_MERCHANT',zoneId:'Rmhvcpnn3iy5f1',cityId:'REVIEW_CITY',governorateId:'REVIEW_GOV',vehicleType:'BIKE'},at='2026-10-17T00:00:00.000Z';
const leg=distanceMeters=>({id:'review',source:'ADMIN_SIMULATION',quality:'ROAD',fallbackPolicyId:null,distanceMeters,durationSeconds:300,measuredAt:at,expiresAt:'2026-10-17T00:02:00.000Z'});
for(const row of review.routeScenarios){const result=driver.calculateDriverEarning({schemaVersion:1,at,context,rules:review.rulesForReview.driverRules.map(v=>({...v,status:'PUBLISHED',finalRounding:baseline.driverEarning.finalRounding})),deliveryRoute:leg(row.deliveryMeters),pickupRoute:leg(row.pickupMeters)});assert.equal(driver.toWholeIqdExact(result.driverEarning),Number(row.driverEarningProposedIqd));}
module.exports={writer,driver,quote};
async function checkQuote(){
 const {fixture}=require('../backend/wallet-service/test/helpers/delivery-quote-fixture.cjs'),sdk=require('../backend/wallet-service/node_modules/@aws-sdk/lib-dynamodb'),{createStagingDeliveryRouting}=require('../backend/wallet-service/dist/regionCoverage');const f=fixture();
 Object.assign(f.policy.values.deliveryRules[0],{perKm:writer.money.parseIqd('500'),minimum:writer.money.parseIqd('2000'),maximum:writer.money.parseIqd('6000'),finalRounding:baseline.customerDelivery.finalRounding});
 const service=quote.createStagingDeliveryQuotes({db:{send:c=>f.db.send(new (c.input.TransactItems?sdk.TransactWriteCommand:c.input.Key?sdk.GetCommand:sdk.QueryCommand)(c.input))},authenticateCustomer:f.auth,now:()=>f.time,
  createRouter:db=>createStagingDeliveryRouting({db,getAccessToken:async()=>'synthetic',profile:'driving',ttlSeconds:120,timeoutMs:1000,now:()=>f.time,fetchImpl:async()=>new Response(JSON.stringify({code:'Ok',routes:[{distance:3331,duration:300}]}))})});
 const q=await service.create({branchId:'b1',addressId:'a1',requestId:'12345678-1234-4123-8123-123456789abc'});assert.equal(q.customerDeliveryFee.minorAmount,2750000);assert.equal((await service.get({quoteId:q.quoteId})).customerDeliveryFee.minorAmount,2750000);
 return {candidateModulesLoaded:3,approvedDriverExamples:review.routeScenarios.length,quoteRoundedIqd:2750,quoteReadMatches:true,strictWalletPrecision:true};
}
if(require.main===module)checkQuote().then(r=>{fs.writeFileSync('/private/tmp/finance63/candidate-tests.json',JSON.stringify(r));console.log(JSON.stringify(r));}).catch(e=>{console.error(e.name,e.code||e.message);process.exitCode=1;});
