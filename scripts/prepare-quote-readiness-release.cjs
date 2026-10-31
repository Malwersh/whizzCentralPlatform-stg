'use strict';
// Offline preparation: preserve live merchant files and use the existing canonical quote handler.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');const root=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bridge=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
 const state=JSON.parse(fs.readFileSync(path.join(audit,'state.json')));if(state.account!=='699561669180'||state.region!=='us-east-1'||state.quoteTable.exists||state.quoteFunction.exists||state.customer.newPathsExist.length)throw Error('NEW_RESOURCES_AND_STAGING_EVIDENCE_REQUIRED');
 cp.execFileSync(process.execPath,[path.join(__dirname,'sync-legacy-order-policy.cjs'),'--check']);cp.execFileSync(process.execPath,[path.join(__dirname,'build-delivery-quote-runtime.cjs'),'--check']);
 fs.mkdirSync(out,{mode:0o700});const save=(n,b)=>{const f=path.join(out,n);fs.writeFileSync(f,b,{mode:0o600});return f;};
 const source=path.join(audit,state.merchantFunction.name+'.zip');const read=n=>Buffer.from(bridge({mode:'read',source,expectedCodeSha256:state.merchantFunction.codeSha256,name:n}).base64,'base64').toString();
 let shared=read('shared/merchant-lifecycle.js');
 shared=replaceOnce(shared,'{fenceMerchantOrderOperation}','{fenceMerchantOrderOperation,canonicalFinancialPreparation}');
 shared=replaceOnce(shared,'    fenceMerchantOrderOperation(item,record);',"    const requestedOrderStatus=operation.ExpressionAttributeValues?.[':status'];\n    fenceMerchantOrderOperation(item,record);\n    const storedOrderStatus=canonicalFinancialPreparation(item,record);");
 shared=replaceOnce(shared,"operation.ExpressionAttributeValues?.[':status']!==actor.deviceOrder.targetStatus","requestedOrderStatus!==actor.deviceOrder.targetStatus");shared=replaceOnce(shared,'after:{status:actor.deviceOrder.targetStatus}','after:{status:storedOrderStatus}');
 const localShared=fs.readFileSync(path.join(root,'../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle.js'),'utf8').replaceAll("require('../auth/branch_devices')","require('../branch_devices')");if(shared!==localShared)throw Error('UNREVIEWED_SHARED_DELTA');
 let main=read('merchant_order_handler.js'),start=main.indexOf('async function handleUpdateOrderStatus('),end=main.indexOf('\nasync function ',start+30);if(start<0||end<0)throw Error('MERCHANT_HANDLER_DRIFT');main=main.slice(0,start)+replaceOnce(main.slice(start,end),'status: status,','status: updatedOrder.status,')+main.slice(end);
 const localMain=fs.readFileSync(path.join(root,'../whizzMerchants-stg/backend/functions/orders/merchant_order_handler.js'),'utf8').replaceAll("require('../shared/merchant-lifecycle')","require('./shared/merchant-lifecycle')");if(main!==localMain)throw Error('UNREVIEWED_MERCHANT_DELTA');
 const files={'shared/merchant-lifecycle.js':save('merchant-lifecycle.js',shared),'merchant_order_handler.js':save('merchant_order_handler.js',main),'shared/legacy-order-policy.js':save('legacy-order-policy.js',fs.readFileSync(path.join(root,'backend/order-service/legacy-order-policy.js')))};
 for(const f of Object.values(files))cp.execFileSync(process.execPath,['--check',f]);
 const merchant=bridge({mode:'patch',source,expectedCodeSha256:state.merchantFunction.codeSha256,destination:path.join(out,'merchant.candidate.zip'),replacements:files,additions:{}});
 const esbuild=require('../backend/wallet-service/node_modules/esbuild');const bytes=esbuild.buildSync({entryPoints:[path.join(root,'../wizzuser-stg/backend/src/functions/delivery-quotes/index.js')],bundle:true,platform:'node',target:'node22',write:false,logLevel:'silent'}).outputFiles[0].contents;
 const entry=save('quote-index.js',bytes);cp.execFileSync(process.execPath,['--check',entry]);const quote=bridge({mode:'new',destination:path.join(out,'quote.candidate.zip'),additions:{'index.js':entry}});
 const template=JSON.parse(fs.readFileSync(path.join(root,'backend/wallet-service/delivery-quotes.staging.json')));save('quote.template.json',JSON.stringify(template,null,2)+'\n');
 const api=JSON.parse(fs.readFileSync(path.join(audit,'customer-api.private.json')));const id=path=>{const r=api.resources.find(x=>x.path===path);if(!r)throw Error('API_PARENT_REQUIRED');return r.id;};
 const quoteKey='cod29/'+sha(fs.readFileSync(path.join(out,'quote.candidate.zip')))+'.zip';const parameters={QuoteCodeBucket:'aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc',QuoteCodeKey:quoteKey,CustomerRestApiId:state.customer.apiId,CustomerRootResourceId:id('/'),CustomerOrdersResourceId:id('/orders'),CustomerAuthorizerId:'r7nmgw',MapboxSecretArn:''};
 const manifest={schemaVersion:1,account:'699561669180',region:'us-east-1',financialActivation:'OFF',quoteEnabled:false,quotaConfigured:false,routingCredentialConfigured:false,existingEnvironmentMutation:false,existingIamMutation:false,merchant:{...state.merchantFunction,...merchant},quote:{name:'WizzUser-DeliveryQuotes-staging',newFunction:true,...quote},stack:{name:'staging-delivery-quotes',sourceTemplate:'backend/wallet-service/delivery-quotes.staging.json',resources:Object.keys(template.Resources),parameters},previousCustomerDeployment:state.customer.deploymentId,existingCustomerPaths:state.customer.paths,policySha256:sha(fs.readFileSync(path.join(root,'backend/order-service/legacy-order-policy.js')))};
 save('manifest.json',JSON.stringify(manifest,null,2)+'\n');return manifest;
}
module.exports={prepare};if(require.main===module){const r=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({resources:r.stack.resources.length,quoteEnabled:r.quoteEnabled,merchant:r.merchant.name}));}
