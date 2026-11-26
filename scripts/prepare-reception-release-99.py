"""Build overlays preserving every unrelated live ZIP entry and runtime configuration."""
from pathlib import Path
import json,zipfile,hashlib,base64
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');L=O/'live';M=R.parent/'whizzMerchants-stg/backend';U=R.parent/'wizzuser-stg/backend';manifest=[]
def overlay(name,changes):
 c=json.loads((L/(name+'.config.private.json')).read_text());p=O/(name+'.candidate99.zip')
 with zipfile.ZipFile(L/(name+'.zip')) as old,zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED) as new:
  for n in old.namelist():
   if n not in changes:new.writestr(n,old.read(n))
  for n,value in changes.items():new.writestr(n,value.encode() if isinstance(value,str) else value)
  assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
 manifest.append({'name':name,'baseRevisionId':c['RevisionId'],'baseCodeSha256':c['CodeSha256'],'candidate':str(p),'sha256':base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode(),'changedFiles':list(changes)})
def merchant(file,shared=False):
 s=file.read_text();return s.replace("require('../../merchant-platform/","require('../merchant-platform/" if shared else "require('./merchant-platform/").replace("require('../auth/","require('../" if shared else "require('./").replace("require('../shared/","require('./shared/" if not shared else "require('../shared/")
shared=['merchant-lifecycle.js','merchant-response-ack.js','merchant-response-policy.js','order-reception.js','notification-sound-policy.js','branch-device-access.js']
for name,handler in [('order-receiver-merchant-orders-staging-v1','orders/merchant_order_handler.js'),('order-receiver-business-staging-status-v1-sam','business/business_online_status_handler.js'),('order-receiver-regional-staging-unified-auth-v4-sam','auth/unified_auth_handler.js')]:
 if not (M/'functions'/handler).exists():
  matches=list((M/'functions').rglob(Path(handler).name));assert len(matches)==1;handler=str(matches[0].relative_to(M/'functions'))
 changes={Path(handler).name:merchant(M/'functions'/handler)}
 for n in shared:changes['shared/'+n]=merchant(M/'functions/shared'/n,True)
 for n in ['branch_devices.js','branch_device_status.js']:changes[n]=merchant(M/'functions/auth'/n)
 if name=='order-receiver-merchant-orders-staging-v1':changes['merchant_pending_response.js']=(O/'merchant_pending_response.js').read_bytes()
 overlay(name,changes)
# Preserve legacy router and financial admission. Replace only its financial runtime.
name='WizzUser-CreateOrder-staging';old=(L/name/'functions/create-order/index.js').read_text()
# The original legacy creator is separately guarded and continues to own its protocol.
# Apply the same pending deadline and durable response event atomically before its save.
needle='        // Save order to DynamoDB';assert old.count(needle)==1
injection="""        let receptionCondition=null;
        if(process.env.MERCHANT_RESPONSE_MODE==='REQUIRED'&&!order.scheduled&&!order.scheduledAt){
          const b=(await dynamoDb.send(new GetCommand({TableName:BUSINESSES_TABLE,Key:{businessId:order.storeId},ConsistentRead:true}))).Item;
          const p=(await dynamoDb.send(new GetCommand({TableName:'staging-PlatformStaff',Key:{pk:'OPERATIONAL_SETTINGS#ORDER_RECEPTION',sk:'CURRENT'},ConsistentRead:true}))).Item;
          if(!b||!b.ownerId||b.ownerId!==b.cognitoUserId)throw Error('MERCHANT_RESPONSE_UNAVAILABLE');
          if(b.ordersPausedUntil&&Date.parse(b.ordersPausedUntil)>Date.now())throw Object.assign(Error('BUSINESS_TEMPORARILY_PAUSED'),{statusCode:409});
          Object.assign(order,require('../shared/merchant-response-policy').pendingFields(order,b,p));
          discountOperations.push({Put:{TableName:'staging-WalletLifecycle',Item:{operationId:'MERCHANT_RESPONSE#'+orderId,kind:'MERCHANT_RESPONSE',merchantResponseSchemaVersion:1,orderId,branchId:order.storeId,ownerId:b.ownerId,status:'PENDING',queuePartition:'MERCHANT_RESPONSE',nextAttemptAt:Math.floor(Date.parse(order.merchantResponsePolicy.autoAccept?createdAt:order.merchantAcceptanceDeadlineAt)/1000),createdAt},ConditionExpression:'attribute_not_exists(operationId)'}});
          receptionCondition={b,at:createdAt};
        }
"""
old=old.replace(needle,injection+needle)
needle="{ConditionCheck: {TableName: BUSINESSES_TABLE, Key: {businessId: body.storeId}, ConditionExpression:";assert old.count(needle)==1
# Merge the extra check into the existing branch target, never a duplicate DynamoDB target.
a=old.index(needle);b=old.index('\n',a);line=old[a:b]
wrapped="...((q)=>{if(receptionCondition){const b=receptionCondition.b;q.ConditionCheck.ConditionExpression+=' AND (attribute_not_exists(#rp) OR #rp<=:rnow)';q.ConditionCheck.ExpressionAttributeNames['#rp']='ordersPausedUntil';q.ConditionCheck.ExpressionAttributeValues[':rnow']=receptionCondition.at;q.ConditionCheck.ExpressionAttributeNames['#rs']='orderReceptionSettings';if(b.orderReceptionSettings===undefined)q.ConditionCheck.ConditionExpression+=' AND attribute_not_exists(#rs)';else{q.ConditionCheck.ConditionExpression+=' AND #rs=:rs';q.ConditionCheck.ExpressionAttributeValues[':rs']=b.orderReceptionSettings;}}return [q];})("+line.rstrip().rstrip(',')+"),"
old=old[:a]+wrapped+old[b:]
overlay(name,{'functions/create-order/index.js':old,'functions/shared/merchant-response-policy.js':(U/'src/functions/shared/merchant-response-policy.js').read_bytes(),'functions/create-order/commercial-runtime.js':(O/'commercial-runtime98.js').read_bytes()})
# Only strengthen the order read; preserve its deployed public response adapter.
name='WizzUser-GetOrder-staging';old=(L/name/'functions/get-order/index.js').read_text();needle='const getCommand = new GetCommand({';pos=old.index(needle,old.index('exports.handler'));old=old[:pos]+old[pos:].replace(needle,needle+'\n            ConsistentRead: true,',1);overlay(name,{'functions/get-order/index.js':old})
name='staging-driver-financial-accept';old=(L/name/'index.js').read_text();needle='function createStagingDriverOfferAcceptance(options) {';assert old.count(needle)==1;old=old.replace(needle,needle+'\n return require("./driver-acceptance-eta98.js").createStagingDriverOfferAcceptance(options);');overlay(name,{'index.js':old,'driver-acceptance-eta98.js':(O/'driver-acceptance-eta98.js').read_bytes()})
overlay('staging-wizz-staff-service',{'index.js':(R/'backend/staff-service/index.js').read_bytes(),'notification-settings-contract.js':(R/'backend/staff-service/notification-settings-contract.js').read_bytes()})
common=['live-activity-order-access.js','order-arrival-content.js','live-activity-push.js','notification-sound-policy.js']
for name,files in [('liveActivityRegister',['live-activity-register.js']),('liveActivityPushUpdate',[]),('liveActivityPushEnd',[]),('pushSendOrderUpdate',['push-order-update.js']),('pushTokensRegister',['push-tokens.js']),('pushSendMerchantOrder',['push-merchant-order.js']),('pushSendWaveOffer',['push-wave-offer.js'])]:
 changes={'src/handlers/'+n:(R/'backend/src/handlers'/n).read_bytes() for n in common+files}
 changes['staff-service/notification-settings-contract.js']=(R/'backend/staff-service/notification-settings-contract.js').read_bytes()
 for n in ['notification-sound-message.js','pinned-wave-push-handler.js']:changes['src/utils/'+n]=(R/'backend/src/utils'/n).read_bytes()
 overlay('wizzcentral-notifications-staging-'+name,changes)
(O/'release99.manifest.private.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'candidateFunctions':len(manifest),'unrelatedEntriesPreserved':True,'published':False}))
