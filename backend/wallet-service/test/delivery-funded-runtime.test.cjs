const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function runtime(mode){
 const seen=[],db={},factory=(name,service)=>o=>{seen.push({name,options:o});return service;};
 const result={},noop=()=>{},methods={run:async()=>({}),accept:async()=>({}),decline:async()=>({}),complete:async()=>({}),requestReturn:async()=>({}),cancelBeforePickup:async()=>({}),unassign:async()=>({}),exhaust:async()=>({}),expire:async()=>({})};
 const operating={version:1,values:{driverOfferTtlSeconds:60,driverPositionMaxAgeSeconds:120,reassignmentWindowSeconds:120,maximumWaves:4},condition:null};
 const modules={
 './financialPushValidation':{createStagingFinancialPushValidation:()=>async()=>({success:true})},
 './financialOfferHydration':{createStagingFinancialOfferHydration:factory('hydrate',async()=>({success:true}))},
 './financeRollout':{createFinanceRollout:()=>({db,order:async()=>{},driver:noop,subject:noop})},
 './deliveryOperations':{readDeliveryOperations:async()=>operating},'./deliveryOperationsPolicy':{validateOperationsSnapshot:()=>operating},'./driverFinancialTransaction':{strongGet:async()=>null},
 './financialSearch':{createStagingFinancialSearch:factory('search',methods)},
 '@aws-sdk/client-dynamodb':{DynamoDBClient:class{}},'@aws-sdk/lib-dynamodb':{DynamoDBDocumentClient:{from:()=>db}},'@aws-sdk/client-cognito-identity-provider':{CognitoIdentityProviderClient:class{}},'@aws-sdk/client-secrets-manager':{SecretsManagerClient:class{}},
 './routingCredentials':{createMapboxSecretReader:()=>async()=> 'unused'},'./roadRouting':{createMapboxRoadRouter:()=>({})},
 './driverOfferContext':{createStagingDriverOfferContext:factory('context',{})},'./driverFinancialWave':{createStagingDriverFinancialWave:factory('wave',methods)},
 './driverOfferAcceptance':{createStagingDriverOfferAcceptance:o=>{seen.push({name:'accept',options:o});o.contextForOffer({source:{driver:{observedAt:'2026-10-18T12:00:00.000Z',expiresAt:'2026-10-18T12:02:00.000Z'}}});return methods;}},
 './codCompletion':{createStagingCodCompletion:factory('complete',methods)},'./codReturn':{createStagingCodReturn:factory('return',methods)},'./codReassignment':{createStagingCodReassignment:factory('reassign',methods)},'./financialIdentity':{authenticateFinancialIdentity:async()=>({})}
 };
 const env={FINANCIAL_DISPATCH_MODE:'REQUIRED',STAGE:'staging',AWS_REGION:'us-east-1',FINANCIAL_OFFER_TTL_SECONDS:'60',FINANCIAL_POSITION_MAX_AGE_SECONDS:'120',FINANCIAL_COD_COMPLETION_MODE:'REQUIRED',FINANCIAL_COD_RETURNS_MODE:'REQUIRED',FINANCIAL_COD_ASSIGNMENTS_MODE:'REQUIRED',...(mode===undefined?{}:{FINANCIAL_DELIVERY_FUNDING_MODE:mode})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/driverFinancialRuntime'),'utf8'),{exports:result,process:{env},require:n=>{assert.ok(n in modules,n);return modules[n];},Date,Number});
 return {api:result,seen};
}
test('actual runtime forwards the same explicit capability to every V2 lifecycle boundary',async()=>{
 for(const mode of [undefined,'OFF','REQUIRED']){
 const {api,seen}=runtime(mode),body={orderId:'order',offerId:'offer',waveNumber:1};
 await api.readFinancialOffer({},'token');
 await api.runFinancialWave({orderId:'order',waveNumber:1,driverIds:[]},async()=>{});
 await api.acceptFinancialOffer(body,'token');await api.acceptFinancialOffer(body,'token',true);
 await api.completeFinancialCod({orderId:'order',cashCollected:true},'token');
 await api.financialCodReturn('request_return',body,'token');
 await api.financialAssignmentTransition('cancel_before_pickup',body,'token');await api.financialAssignmentTransition('unassign_financial',body,'token');
 await api.exhaustFinancialSearch('order');await api.expireFinancialWave('order',1);
 assert.ok(seen.length>=12);for(const item of seen)assert.equal(item.options.enableDeliveryFunding,mode==='REQUIRED',item.name);
 }
});
test('invalid runtime capability fails before constructing any financial service',async()=>{
 const {api,seen}=runtime('typo');await assert.rejects(api.exhaustFinancialSearch('order'),/DELIVERY_FUNDING_NOT_CONFIGURED/);assert.equal(seen.length,0);
});
test('V2 search exhaustion preserves original cash and campaign reservations for review',async()=>{
 const {fixture}=require('./helpers/delivery-funded-driver-fixture.cjs'),{createStagingFinancialSearch}=require('../dist/financialSearch');
 const f=await fixture();await f.run();const job=f.get('WizzDispatchJobs_staging',{orderId:'order1',SK:'METADATA'});
 f.time=Date.parse(job.expiresAt);
 const funds=()=>JSON.stringify([...f.rows].filter(([k])=>/^(staging-Wallets|staging-Holds|staging-LedgerEntries|staging-PlatformStaff)\|/.test(k))),before=funds();
 assert.equal((await createStagingFinancialSearch({db:f.db,now:()=>f.time,enableDeliveryFunding:true}).exhaust('order1')).exhausted,true);
 assert.equal(funds(),before);assert.equal(f.get('WizzOrders',{PK:'ORDER#order1',SK:'META'}).financialSearch.reviewStatus,'REQUIRED');
});
