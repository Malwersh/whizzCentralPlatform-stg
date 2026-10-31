'use strict';
const fs=require('fs'),path=require('path'),cp=require('child_process');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const root=path.resolve(__dirname,'..'),[audit,out]=process.argv.slice(2);
if(!path.isAbsolute(audit||'')||!path.isAbsolute(out||'')||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
fs.mkdirSync(out,{mode:0o700});
const archive=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
cp.execFileSync(process.execPath,[path.join(__dirname,'build-driver-financial-runtime.cjs'),path.join(out,'runtime')]);
const runtime=path.join(out,'runtime/financial-runtime.js'),save=(n,bytes)=>{const f=path.join(out,n);fs.writeFileSync(f,bytes,{mode:0o600});return f;};
const router=require('../backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:[path.join(root,'../wizzuser-stg/backend/src/functions/create-order/commercial-order-router.js')],platform:'node',target:'node20',bundle:true,write:false,logLevel:'silent'}).outputFiles[0].contents;
const routerFile=save('commercial-order-router.js',router),functions=[];
for(const name of ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','order-receiver-merchant-orders-staging-v1','WizzUser-GetUserOrders-staging','WizzUser-GetOrder-staging']){
 const c=JSON.parse(fs.readFileSync(path.join(audit,name+'.private.json'))),source=path.join(audit,name+'.zip');
 const read=file=>Buffer.from(archive({mode:'read',source,expectedCodeSha256:c.CodeSha256,name:file}).base64,'base64').toString();let replacements={};
 if(name.startsWith('WaveSystem_')){const file=path.join(root,'lambda',name,'index.js');replacements={'index.js':file,'financial-runtime.js':runtime};save(name+'.before.js',read('index.js'));}
 else if(name==='staging-driver-financial-accept')replacements={'index.js':runtime};
 else if(name.includes('merchant')){
  let text=fs.readFileSync(path.join(root,'../whizzMerchants-stg/backend/functions/orders/merchant_order_handler.js'),'utf8').replaceAll("require('../shared/merchant-lifecycle')","require('./shared/merchant-lifecycle')");
  let expected=read('merchant_order_handler.js');expected=replaceOnce(expected,'financialAcceptance,codFinancialEvidence,...view','financialAcceptance,codFinancialEvidence,financialSearch,...view');
  expected=replaceOnce(expected,'financialAssignment:financialOrderAssignment(order),',"driverSearchUnavailable:order.financialSearch?.status==='no_driver_available'&&order.dispatchStatus==='no_driver_available', financialAssignment:financialOrderAssignment(order),");
  expected=replaceOnce(expected,'financialAssignment: financialOrderAssignment(order),',"driverSearchUnavailable:order.financialSearch?.status==='no_driver_available'&&order.dispatchStatus==='no_driver_available', financialAssignment: financialOrderAssignment(order),");if(text!==expected)throw Error('MERCHANT_SOURCE_DRIFT');replacements={'merchant_order_handler.js':save('merchant_order_handler.js',text)};
 }else{
  let expected=read('functions/create-order/commercial-order-router.js');expected=replaceOnce(expected,'financialAcceptance, codFinancialEvidence, ...view','financialAcceptance, codFinancialEvidence, financialSearch, ...view');expected=replaceOnce(expected,'      return view;',`      return { ...view, ...financialSearch?.status === "no_driver_available" && order.dispatchStatus === "no_driver_available" ? { driverSearchUnavailable: true } : {} };`);
  if(expected!==Buffer.from(router).toString())throw Error('CUSTOMER_ROUTER_SOURCE_DRIFT');replacements={'functions/create-order/commercial-order-router.js':routerFile};
 }
 const updated=archive({mode:'patch',source,expectedCodeSha256:c.CodeSha256,destination:path.join(out,name+'.zip'),replacements,additions:{}});
 functions.push({name,baseCodeSha256:c.CodeSha256,baseRevisionId:c.RevisionId,handler:c.Handler,...updated});
}
fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({schemaVersion:1,stage:'staging',financialActivation:'OFF',functions},null,2)+'\n');console.log(JSON.stringify({functions:functions.length,activation:'OFF'}));
