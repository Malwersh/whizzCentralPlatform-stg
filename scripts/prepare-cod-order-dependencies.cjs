'use strict';
// Build an OFF-only release from freshly downloaded live packages. No AWS mutation.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const {replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const root=path.resolve(__dirname,'..'),customer=path.resolve(root,'../wizzuser-stg/backend/src/functions');
const merchant=path.resolve(root,'../whizzMerchants-stg/backend/functions/orders');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const archive=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
function merchantPatch(live,local){
 const transformed=local.replaceAll("require('../shared/merchant-lifecycle')","require('./shared/merchant-lifecycle')");
 const start='// Helper: normalize order shape for frontend',end='/**\n * Check if business is accepting orders';
 const span=(s,a,b)=>{const n=s.indexOf(a),m=s.indexOf(b,n);if(n<0||m<0)throw Error('MERCHANT_ANCHOR_CHANGED');return s.slice(n,m);};
 const helper=span(transformed,'function financialOrderAssignment(',end);
 live=replaceOnce(live,span(live,start,end),helper);
 for(const [a,b] of [
  ["['pending', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'on_the_way', 'delivered']","['pending', 'confirmed', 'preparing', 'ready', 'ready_for_pickup', 'assigned', 'heading_to_store', 'arrived_at_store', 'picked_up', 'heading_to_customer', 'arrived_at_customer', 'returning', 'return_arrived', 'on_the_way', 'delivered']"],
  ['const totalAmount = pricing.total || 0;','const totalAmount = pricing.total != null ? Number(pricing.total) / 1000 : Number(order.totalAmount ?? order.total ?? 0);'],
  ['const deliveryFee = pricing.deliveryFee || 0;','const deliveryFee = pricing.deliveryFee != null ? Number(pricing.deliveryFee) / 1000 : Number(order.deliveryFee ?? order.delivery_fee ?? 0);'],
  ['return {\n                id: order.orderId,','return {\n                financialAssignment: financialOrderAssignment(order),\n                id: order.orderId,'],
  ['total: (order.pricing && order.pricing.total) || order.total || 0,','total: order.pricing?.total != null ? Number(order.pricing.total) / 1000 : Number(order.total ?? order.totalAmount ?? 0),']
 ])live=replaceOnce(live,a,b);
 if(live!==transformed)throw Error('UNREVIEWED_MERCHANT_DELTA');return live;
}
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
 const evidence=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));if(evidence.account!=='699561669180'||evidence.region!=='us-east-1')throw Error('STAGING_ONLY');
 const defs=evidence.functions.filter(f=>['WizzUser-CreateOrder-staging','WizzUser-GetOrder-staging','WizzUser-GetUserOrders-staging','WizzUser-GetGuestOrders-staging','WizzUser-SearchOrderByNumber-staging','WizzUser-CancelOrder-staging','WizzUser-UpdateOrderStatus-staging','order-receiver-merchant-orders-staging-v1'].includes(f.name));
 if(defs.length!==8)throw Error('LIVE_INVENTORY_INCOMPLETE');
 for(const f of defs){if(!f.tags['aws:cloudformation:stack-name'])throw Error('OWNERSHIP_REQUIRED');if(Object.values(f.flags).some(x=>x==='REQUIRED'))throw Error('FINANCIAL_MODE_ALREADY_ENABLED');}
 cp.execFileSync(process.execPath,[path.join(__dirname,'sync-delivery-quote-order-runtime.cjs'),'--check']);
 fs.mkdirSync(out,{mode:0o700});
 const save=(n,b)=>{const p=path.join(out,n);fs.writeFileSync(p,b,{mode:0o600});return p;};
 const esbuild=require('../backend/wallet-service/node_modules/esbuild');
 const bundle=(entry,external=[])=>esbuild.buildSync({entryPoints:[entry],platform:'node',target:'node20',bundle:true,external,write:false,logLevel:'silent'}).outputFiles[0].contents;
 const runtime=save('commercial-runtime.js',bundle(path.join(customer,'create-order/index.js'),['aws-sdk']));
 const publicAdapter=save('commercial-order-router.js',bundle(path.join(customer,'create-order/commercial-order-router.js')));
 const results=[];
 for(const f of defs){
  const file=f.handler.slice(0,-'.handler'.length)+'.js',source=path.join(audit,f.name+'.zip');
  const live=Buffer.from(archive({mode:'read',source,expectedCodeSha256:f.codeSha256,name:file}).base64,'base64').toString();
  if(hash(live)!==f.files[file])throw Error('LIVE_SOURCE_HASH_CHANGED');
  let updated,files={};
  if(f.name==='order-receiver-merchant-orders-staging-v1'){
   updated=merchantPatch(live,fs.readFileSync(path.join(merchant,'merchant_order_handler.js'),'utf8'));
   const posLive=Buffer.from(archive({mode:'read',source,expectedCodeSha256:f.codeSha256,name:'pos_forwarding_service.js'}).base64,'base64').toString();
   let pos=replaceOnce(posLive,'return order.pricing.total;','return order.pricing.total / 1000;');pos=replaceOnce(pos,'return order.pricing.deliveryFee;','return order.pricing.deliveryFee / 1000;');
   if(pos!==fs.readFileSync(path.join(merchant,'pos_forwarding_service.js'),'utf8'))throw Error('UNREVIEWED_POS_DELTA');
   files['pos_forwarding_service.js']=save('pos_forwarding_service.js',pos);
  }else{
   if(live.includes('COD_DEPENDENCIES_V1'))throw Error('ALREADY_PATCHED');
   const wrapper=f.name==='WizzUser-CreateOrder-staging'?
    "exports.handler = require('./commercial-order-router').createCommercialOrderRouter({legacy:exports.handler,loadCommercial:()=>require('./commercial-runtime').handler});":
    "exports.handler = ((legacy)=>async(event,context)=>require('../create-order/commercial-order-router').publicOrderResponse(await legacy(event,context)))(exports.handler);";
   updated=live+'\n// COD_DEPENDENCIES_V1: downloaded legacy source above is preserved byte-for-byte.\n'+wrapper+'\n';
   if(!updated.startsWith(live))throw Error('LEGACY_PRESERVATION_FAILED');
   files['functions/create-order/commercial-order-router.js']=publicAdapter;
   if(f.name==='WizzUser-CreateOrder-staging')files['functions/create-order/commercial-runtime.js']=runtime;
  }
  const target=save(f.name+'.candidate.js',updated);cp.execFileSync(process.execPath,['--check',target]);files[file]=target;
  const replacements=Object.fromEntries(Object.entries(files).filter(([n])=>f.files[n]));const additions=Object.fromEntries(Object.entries(files).filter(([n])=>!f.files[n]));
  const zip=archive({mode:'patch',source,expectedCodeSha256:f.codeSha256,destination:path.join(out,f.name+'.candidate.zip'),replacements,additions});
  results.push({name:f.name,handler:f.handler,ownerStack:f.tags['aws:cloudformation:stack-name'],baseRevisionId:f.revisionId,baseCodeSha256:f.codeSha256,baseSourceSha256:hash(live),candidateSourceSha256:hash(updated),legacySourcePrefixPreserved:f.name!=='order-receiver-merchant-orders-staging-v1',...zip});
 }
 const result={schemaVersion:1,account:'699561669180',region:'us-east-1',activation:'OFF',environmentMutation:false,iamMutation:false,apiMutation:false,functions:results,
  sourceHashes:Object.fromEntries(['create-order/index.js','create-order/commercial-order-router.js','shared/customer-order-view.js'].map(f=>[f,hash(fs.readFileSync(path.join(customer,f)))])),
  activationBlockers:['Quote API/table/credential/rate limits and cleanup activation','Commercial source IAM and approved source records','Authenticated preview API route','Legacy status writers need financial fencing before activation','Deployed-role financial transactions and coordinated application/device canary']};
 save('manifest.json',JSON.stringify(result,null,2)+'\n');return result;
}
module.exports={prepare,merchantPatch};
if(require.main===module){const r=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({functions:r.functions.length,activation:r.activation}));}
