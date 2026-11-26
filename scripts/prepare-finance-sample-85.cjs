'use strict';
// Offline preparation only: exact authenticated accounts and canonical Checkout IDs; never deploys or activates.
const fs=require('node:fs'),{randomUUID}=require('node:crypto'),assert=require('node:assert/strict');
const {quoteHash}=require('../backend/wallet-service/dist/deliveryQuoteRecord');
const {orderIdFor}=require('../backend/wallet-service/dist/deliveryQuoteOrder');
const {check}=require('./check-finance-rollout-deployment.cjs');
const out='/private/tmp/finance85/',ids=JSON.parse(fs.readFileSync(out+'selected-identities.private.json')),assets=JSON.parse(fs.readFileSync(out+'sample-assets.private.json'));
const profile=ids.profiles.customer[0],customer=ids.identities.customer.subjectId,driver=ids.profiles.driver[0].driverId,driverSubject=ids.identities.driver.subjectId;
assert(profile.userId&&[profile.userId,profile.cognitoSub,profile.cognitoUserId].includes(customer),'CUSTOMER_PROFILE_SUBJECT_BINDING_REQUIRED');
let cases;if(fs.existsSync(out+'checkout-cases.private.json'))cases=JSON.parse(fs.readFileSync(out+'checkout-cases.private.json'));else{cases=['COD_COMPLETE_NO_DISCOUNT','PREASSIGNMENT_RELEASE_NO_DISCOUNT','CANCEL_BEFORE_PICKUP_NO_DISCOUNT'].map(name=>{const requestId=randomUUID();return {name,requestId,orderId:orderIdFor(profile.userId,requestId)};});fs.writeFileSync(out+'checkout-cases.private.json',JSON.stringify(cases,null,2),{mode:0o600});}
const config={schemaVersion:1,accountId:'699561669180',region:'us-east-1',scopes:[{id:'fattoush-finance-sample-85',version:1,mode:'SCOPED',admitUntil:new Date(Date.now()+2*3600000).toISOString(),orders:cases.map(c=>({orderId:c.orderId,branchId:assets.branchId,customerSubjectId:customer})),drivers:[{driverId:driver,subjectId:driverSubject}]}]};
const base=JSON.parse(fs.readFileSync('/private/tmp/finance84/scope-manifest.private.json'));for(const f of base.functions){f.env={...f.env,ENVIRONMENT:'staging',FINANCE_ROLLOUT_CONFIG:JSON.stringify(config),FINANCE_ROLLOUT_SHA256:quoteHash(config)};}
const validation=check(base);fs.writeFileSync(out+'scope-candidate.private.json',JSON.stringify(base,null,2),{mode:0o600});
const attempt={schemaVersion:1,userId:profile.userId,branchId:assets.branchId,requestId:cases[0].requestId};
fs.writeFileSync(out+'user-dart-defines.private.json',JSON.stringify({ENVIRONMENT:'staging',API_URL:'https://4jut6787c8.execute-api.us-east-1.amazonaws.com/staging',COMMERCIAL_PRICING_ENABLED:'true',DELIVERY_QUOTES_ENABLED:'true',FINANCE_TEST_CHECKOUT_ATTEMPT:JSON.stringify(attempt)},null,2),{mode:0o600});
const result={prepared:true,hosts:validation.functions,exactOrderCount:cases.length,customerCount:1,driverCount:1,checkoutMatchesCanonicalOrder:true,firstCase:cases[0].name,discount:'NONE',scopePublished:false,financialActivation:false,secondDriverNeededForReassignment:true};fs.writeFileSync(out+'scope-preparation.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
