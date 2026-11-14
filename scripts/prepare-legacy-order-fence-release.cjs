'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),{replaceOnce}=require('./prepare-delivery-quote-order.cjs');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const bridge=r=>JSON.parse(cp.execFileSync('python3',[path.join(__dirname,'quote-release-archive.py')],{input:JSON.stringify(r),encoding:'utf8',maxBuffer:12*1024*1024}));
function prepare(audit,out){
 if(!path.isAbsolute(audit)||!path.isAbsolute(out)||fs.existsSync(out))throw Error('NEW_ABSOLUTE_OUTPUT_REQUIRED');
 const evidence=JSON.parse(fs.readFileSync(path.join(audit,'inventory.json')));if(evidence.account!=='699561669180'||evidence.region!=='us-east-1'||evidence.functions.length!==10)throw Error('FRESH_STAGING_EVIDENCE_REQUIRED');
 cp.execFileSync(process.execPath,[path.join(__dirname,'sync-legacy-order-policy.cjs'),'--check']);
 fs.mkdirSync(out,{mode:0o700});const save=(n,b)=>{const f=path.join(out,n);fs.writeFileSync(f,b,{mode:0o600});return f;};
 const policy=save('legacy-order-policy.js',fs.readFileSync(path.join(root,'backend/order-service/legacy-order-policy.js')));
 const esbuild=require('../backend/wallet-service/node_modules/esbuild');const commercial=save('commercial-runtime.js',esbuild.buildSync({entryPoints:[path.join(root,'../wizzuser-stg/backend/src/functions/create-order/index.js')],bundle:true,platform:'node',target:'node20',external:['aws-sdk'],write:false,logLevel:'silent'}).outputFiles[0].contents);
 const functions=[];
 for(const f of evidence.functions){
  if(!f.tags['aws:cloudformation:stack-name'])throw Error('CFN_OWNER_REQUIRED');const source=path.join(audit,f.name+'.zip');
  const read=n=>Buffer.from(bridge({mode:'read',source,expectedCodeSha256:f.codeSha256,name:n}).base64,'base64').toString();
  const entry=f.handler.slice(0,-'.handler'.length)+'.js';let live=read(entry),updated=live,files={};
  if(f.name==='WizzUser-CreateOrder-staging'){
   updated=replaceOnce(updated,"const activeStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'in_kitchen', 'out_for_delivery'];","const isTerminalOrderStatus = require('../shared/legacy-order-policy').isTerminalOrderStatus;");
   updated=replaceOnce(updated,'activeStatuses.includes(order.status)','!isTerminalOrderStatus(order.status)');files['functions/create-order/commercial-runtime.js']=commercial;
  }else if(f.name==='WizzUser-UpdateOrderStatus-staging'){
   updated="const {isFinancialOrder,LEGACY_ONLY}=require('../shared/legacy-order-policy');\n"+updated;
   updated=replaceOnce(updated,'const currentOrder = getResult.Item;',"const currentOrder = getResult.Item;\n        if (isFinancialOrder(currentOrder)) return {statusCode:409,headers,body:JSON.stringify({success:false,code:'FINANCIAL_ORDER_WORKFLOW_REQUIRED'})};");
   updated=replaceOnce(updated,"ConditionExpression: '#rev = :currentRev'","ConditionExpression: '('+LEGACY_ONLY+') AND #rev = :currentRev'");
  }else if(f.name==='WizzUser-CancelOrder-staging'){
   updated="const {isFinancialOrder}=require('../shared/legacy-order-policy');\n"+updated;
   updated=replaceOnce(updated,'const currentOrder = currentOrderResult.Item;',"const currentOrder = currentOrderResult.Item;\n        if (isFinancialOrder(currentOrder)) return {statusCode:409,headers,body:JSON.stringify({success:false,code:'FINANCIAL_ORDER_WORKFLOW_REQUIRED'})};");
  }else if(['WizzUser-GetGuestOrders-staging','WizzUser-GetUserOrders-staging'].includes(f.name)){
   updated="const {customerStatusFilter}=require('../shared/legacy-order-policy');\n"+updated;
   const guest=f.name==='WizzUser-GetGuestOrders-staging',variable=guest?'queryParameters':'queryCommand',selector=guest?'statusFilter':'status';
   const start=updated.indexOf("            if ("+selector+" === 'active') {"),end=guest?updated.indexOf('            }\n        }',start):updated.indexOf('            } else {',start);
   if(start<0||end<0)throw Error('HISTORY_SOURCE_ANCHOR_CHANGED');
   const replacement="            if (['active','completed'].includes("+selector+")) {\n                const filter=customerStatusFilter("+selector+");\n                "+variable+".FilterExpression=filter.expression;\n                "+variable+".ExpressionAttributeNames={..."+variable+".ExpressionAttributeNames,...filter.names};\n                "+variable+".ExpressionAttributeValues={..."+variable+".ExpressionAttributeValues,...filter.values};\n";
   updated=updated.slice(0,start)+replacement+updated.slice(end);
  }else if(f.name==='WizzUser-MerchantOrderStatusUpdate-staging'){
   updated="const {isFinancialOrder,LEGACY_ONLY}=require('./legacy-order-policy');\n"+updated;
   updated=replaceOnce(updated,'const order = currentOrder.Item;',"const order = currentOrder.Item;\n        if(isFinancialOrder(order))return {statusCode:409,headers,body:JSON.stringify({success:false,code:'FINANCIAL_ORDER_WORKFLOW_REQUIRED'})};");
   updated=replaceOnce(updated,'            UpdateExpression: updateExpression,','            ConditionExpression: LEGACY_ONLY,\n            UpdateExpression: updateExpression,');
  }else if(f.name==='order-receiver-merchant-orders-staging-v1'){
   const local=fs.readFileSync(path.join(root,'../whizzMerchants-stg/backend/functions/orders/merchant_order_handler.js'),'utf8').replaceAll("require('../shared/merchant-lifecycle')","require('./shared/merchant-lifecycle')");
   updated=replaceOnce(updated,"statusesToQuery = ['delivered', 'completed'];","statusesToQuery = ['delivered', 'completed', 'returned'];");
   updated=updated.replaceAll("createResponse(500, { success: false, message:","createResponse(error.code==='FINANCIAL_ORDER_WORKFLOW_REQUIRED'?409:500, { success: false, ...(error.code==='FINANCIAL_ORDER_WORKFLOW_REQUIRED'?{code:error.code}:{}), message:");if(updated!==local)throw Error('UNREVIEWED_MERCHANT_DELTA');
   let shared=read('shared/merchant-lifecycle.js');
   shared=replaceOnce(shared,"'use strict';","'use strict';\nconst {fenceMerchantOrderOperation}=require('./legacy-order-policy');");
   shared=replaceOnce(shared,"if(!field||record[field]!==actor.businessId)throw Error('ORDER_BUSINESS_SCOPE_INVALID');","if(!field||record[field]!==actor.businessId)throw Error('ORDER_BUSINESS_SCOPE_INVALID');\n    fenceMerchantOrderOperation(item,record);");
   const expected=fs.readFileSync(path.join(root,'../whizzMerchants-stg/backend/functions/shared/merchant-lifecycle.js'),'utf8').replaceAll("require('../auth/branch_devices')","require('../branch_devices')");
   if(shared!==expected)throw Error('UNREVIEWED_SHARED_LAYOUT_DELTA');
   files['shared/merchant-lifecycle.js']=save('merchant-lifecycle.js',shared);files['shared/legacy-order-policy.js']=policy;
  }else if(f.name==='DriversApi-staging')updated=fs.readFileSync(path.join(root,'../whizzDrivers-stg/backend/lambda_driver_api_v2.js'),'utf8');
  else if(f.name==='WaveSystem_HandleDriverAccept')updated=fs.readFileSync(path.join(root,'lambda/WaveSystem_HandleDriverAccept/index.js'),'utf8');
  else if(f.name==='OrderService-staging'){
   // The router/index has no changes in this package; compare it and retain the live bytes.
   updated=live;
   for(const name of ['orderCancellationService','driverUnassignmentService'])files['dist/'+name+'.js']=save(name+'.js',fs.readFileSync(path.join(root,'backend/order-service/dist/'+name+'.js')));
  }else throw Error('UNEXPECTED_FUNCTION');
  if(f.name.startsWith('WizzUser-')&&f.name!=='WizzUser-MerchantOrderStatusUpdate-staging')files['functions/shared/legacy-order-policy.js']=policy;
  else if(['OrderService-staging','DriversApi-staging','WaveSystem_HandleDriverAccept','WizzUser-MerchantOrderStatusUpdate-staging'].includes(f.name))files['legacy-order-policy.js']=policy;
  if(updated!==live)files[entry]=save(f.name+'.candidate.js',updated);
  for(const file of Object.values(files))cp.execFileSync(process.execPath,['--check',file]);
  const replacements=Object.fromEntries(Object.entries(files).filter(([n])=>f.files[n]));const additions=Object.fromEntries(Object.entries(files).filter(([n])=>!f.files[n]));
  const zip=bridge({mode:'patch',source,expectedCodeSha256:f.codeSha256,destination:path.join(out,f.name+'.candidate.zip'),replacements,additions});
  functions.push({name:f.name,handler:f.handler,ownerStack:f.tags['aws:cloudformation:stack-name'],baseRevisionId:f.revisionId,baseCodeSha256:f.codeSha256,baseSourceSha256:hash(live),candidateSourceSha256:hash(updated),...zip});
 }
 const result={schemaVersion:1,account:'699561669180',region:'us-east-1',activation:'OFF',environmentMutation:false,iamMutation:false,apiMutation:false,policySha256:hash(fs.readFileSync(policy)),functions};save('manifest.json',JSON.stringify(result,null,2)+'\n');return result;
}
module.exports={prepare};if(require.main===module){const r=prepare(process.argv[2],process.argv[3]);console.log(JSON.stringify({functions:r.functions.length,activation:r.activation}));}
