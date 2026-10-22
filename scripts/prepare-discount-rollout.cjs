'use strict';
// Offline, reviewable bundles only. Never contacts AWS or changes feature gates.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),out=process.argv[2];
if(!out||!path.isAbsolute(out))throw Error('Provide an absolute artifact directory');
if(fs.existsSync(path.join(out,'manifest.json')))throw Error('Artifact directory already has a manifest; choose a fresh directory');
const esbuild=require('../backend/wallet-service/node_modules/esbuild');
const {execFileSync}=require('node:child_process');
const runtimeChecks=['sync-discount-runtime.cjs','sync-branch-product-options.cjs','sync-branch-product-pricing.cjs','sync-delivery-pricing-runtime.cjs','sync-delivery-quote-order-runtime.cjs','sync-offer-usage-release.cjs'];
for(const script of runtimeChecks)execFileSync(process.execPath,[path.join(root,'scripts',script),'--check'],{stdio:'pipe'});
const extraModules=process.env.DISCOUNT_BUILD_NODE_MODULES;
if(extraModules&&!path.isAbsolute(extraModules))throw Error('DISCOUNT_BUILD_NODE_MODULES must be absolute');
const user=path.resolve(root,'../wizzuser-stg'),merchant=path.resolve(root,'../whizzMerchants-stg');
const entries=[
 ['central-staff',path.join(root,'backend/staff-service/index.js')],
 ...['create-order','cancel-order','get-store-discounts','get-active-promo-codes','validate-promo-code','apply-promo-code','get-business-products'].map(n=>['user-'+n,path.join(user,'backend/src/functions',n,'index.js')]),
 ['merchant-products',path.join(merchant,'backend/functions/products/product_management_handler.js')],
 ['merchant-discounts',path.join(merchant,'backend/functions/discounts/discount_management_handler.js')],
 ['merchant-pending-response',path.join(root,'backend/wallet-service/src/merchantResponseAdapter.ts')],
 ['merchant-response-worker',path.join(root,'backend/wallet-service/src/merchantResponseRuntime.ts')],
];
async function main(){
fs.mkdirSync(out,{recursive:true});
const manifest={deployed:false,createdAt:new Date().toISOString(),cashDiscountQuantumIqd:250,commercialCashTotalPolicy:'REQUIRE_MULTIPLE_OF_250_IQD',modifierPricingOwnership:'BRANCH',runtimeChecksPassed:runtimeChecks,customerDeliveryRounding:{incrementIqd:250,mode:'CEILING',stage:'AFTER_PROMOTION'},
 unresolved:['Approved disposable staging customer, branch and address IDs'],
 requiredReviews:['Execution-role IAM supplements','Existing finance rollout scope and capability flags','Cancellation flag remains OFF until IAM and staging verification complete'],
 artifacts:[],failures:[]};
for(const [name,entry] of entries){
 const destination=path.join(out,name,'index.js');
 try{
  await esbuild.build({entryPoints:[entry],outfile:destination,bundle:true,platform:'node',target:'node20',keepNames:true,
   nodePaths:[path.join(root,'backend/wallet-service/node_modules'),...(extraModules?[extraModules]:[])],
   plugins:[{name:'resolve-packaged-lambda-sdk-fallback',setup(build){build.onResolve({filter:/^\.\/campaign-sdk\/node_modules\/@aws-sdk\/client-lambda$/},()=>({path:require.resolve('@aws-sdk/client-lambda',{paths:[path.join(root,'backend/wallet-service/node_modules'),...(extraModules?[extraModules]:[])]})}));}}],logLevel:'silent'});
  const content=fs.readFileSync(destination);
  manifest.artifacts.push({name,source:entry,file:destination,bytes:content.length,sha256:crypto.createHash('sha256').update(content).digest('hex')});
 }catch(error){manifest.failures.push({name,message:error.message});}
}
const policies=['offer-usage-release-access.yaml','financial-customer-cancellation-access.yaml','branch-product-pricing-access.yaml','customer-offer-read-access.yaml'];
for(const file of policies){const dest=path.join(out,file);fs.copyFileSync(path.join(root,'backend/wallet-service',file),dest);}
fs.copyFileSync(path.join(user,'backend/offer-journey-template.json'),path.join(out,'offer-journey-template.json'));
manifest.readyForDeployment=manifest.failures.length===0&&manifest.unresolved.length===0;
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({deployed:false,readyForDeployment:manifest.readyForDeployment,bundles:manifest.artifacts.length,failures:manifest.failures}));
if(manifest.failures.length)process.exitCode=1;

}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
