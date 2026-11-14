'use strict';
// Local review artifacts only: no AWS SDK, credentials, publish, IAM or env updates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('ABSOLUTE_REVIEW_OUTPUT_REQUIRED');
fs.mkdirSync(out,{recursive:true});
const bundles=[];
for(const [name,source]of [['merchant-response-worker','merchantResponseRuntime'],['merchant_pending_response','merchantResponseAdapter']]){
 const bytes=esbuild.buildSync({entryPoints:[path.join(root,'backend/wallet-service/src/'+source+'.ts')],platform:'node',target:'node22',bundle:true,keepNames:true,write:false,logLevel:'silent'}).outputFiles[0].contents;
 fs.writeFileSync(path.join(out,name+'.js'),bytes);bundles.push({name,file:name+'.js',sha256:crypto.createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});
}
const release={schemaVersion:1,part:148,stage:'staging',region:'us-east-1',accountId:'699561669180',reviewOnly:true,deployable:false,applied:false,activation:'OFF',bundles,
 requiredCapabilityDefaults:{DELIVERY_PROMOTION_MODE:'OFF',FINANCIAL_DELIVERY_FUNDING_MODE:'OFF',DELIVERY_FUNDING_MANAGEMENT_ENABLED:'false'},
 requiredCoordinatedHosts:['customer create-order/commercial-preview','staff commercial management and owner consent','commercial notice worker and push','dispatch creator/start/timeout/accept/reject','financial driver acceptance/completion/return/reassignment','COD integration','merchant manual rejection adapter','merchant response deadline/auto-accept worker'],
 sourceFindings:[{source:'backend/wallet-service/cod-lifecycle.staging.json',statement:'PublishedPricingPolicy',finding:'Existing source policy only allows operational settings; it does not grant campaign budget/usage/reservation access required by delivery-funded acceptance and terminal lifecycle.'},{source:'docs/reception-notification-permissions-99.md',finding:'Prior reception approval did not include delivery campaign allowance/usage records; cannot treat it as approval for this new table-prefix authority.'}],
 requiredAccessReview:[
 {host:'customer create-order',table:'staging-PlatformStaff',readAndConditionPrefixes:['DELIVERY_FUNDING#*','DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*','EMPLOYEE#*','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS'],conditionalPutPrefixes:['DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*']},
 {host:'customer create-order',table:'staging-MerchantPlatform',consistentQueryPrefixes:['BRANCH#*'],readAndConditionPrefixes:['BRANCH#*','PERSON#*']},
 {host:'financial acceptance/completion/release and merchant pending rejection/expiry',table:'staging-PlatformStaff',readAndConditionPrefixes:['DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*'],conditionalPutPrefixes:['DELIVERY_BUDGET#*','DELIVERY_USAGE#*','DELIVERY_RESERVATION#*']},
 {host:'staff delivery send/accept',table:'staging-PlatformStaff',reviewExistingAuthority:true,prefixes:['DELIVERY_FUNDING#*','DELIVERY_BUDGET#*','EMPLOYEE#*']},
 {host:'staff named region picker',table:'WizzCentral_Regions',reviewExistingAuthority:true,actions:['Scan'],projectedAttributes:['regionId','parent_id','level','name','name_ar','is_active','isDeleted','deletedAt']}
 ],
 invariants:['No new driver/merchant wallet authority for merchant response worker or merchant rejection adapter; they release platform promotion cash only.','Hold sort-key descriptions are runtime conditions, not IAM sort-key restrictions.','Campaign allowance is not wallet cash. No DeleteItem, new table/index, payout, transfer or Cognito change.','Compare actual live role policies and CloudFormation ownership before producing/applying a minimal IAM delta.','No automatic migration or backfill of financial orders.','Preserve hosted-financial dispatch restriction until its entry point and scheduling are verified.'],
 blockers:['Live role/package/configuration comparison and minimal IAM policy simulation not done','No physical device or real staging end-to-end verification','Hosted financial scheduler entry-point remains gated','Original-share refunds/partial returns and legacy coupon timestamp repair remain'],
};
fs.writeFileSync(path.join(out,'review.json'),JSON.stringify(release,null,2)+'\n');
console.log(JSON.stringify({review:path.join(out,'review.json'),bundles:bundles.map(b=>({name:b.name,bytes:b.bytes})),activation:'OFF',applied:false}));
