"""Narrow staging package patches, preserving every other deployed archive entry."""
import pathlib,json,subprocess,zipfile,hashlib,base64,io,importlib.util
root=pathlib.Path(__file__).resolve().parents[1];temp=pathlib.Path('/private/tmp/customer494-live')
common=['--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 data=subprocess.check_output(['aws',*args,*common]);return json.loads(data) if data.strip() else {}
def digest(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
spec=importlib.util.spec_from_file_location('support_patch',root/'backend/customer-notifications-494/support_patch.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
helper=(root/'backend/src/utils/customer-inbox.js').read_bytes()
source=temp/'wizzcentral-websocket-staging-liveChatMessage/src/handlers/websocket-connections.js'
# Retain the deployed worker's finance-rollout bootstrap exactly.
worker=(temp/'staging-wizz-wallet-notification-worker/index.js').read_text()
old="{type:item.type,eventId:item.eventId,driverId:item.driverId,topupId:"
assert worker.count(old)==1
worker=worker.replace(old,"{type:item.type,eventId:item.eventId,driverId:item.driverId,...(item.orderId?{orderId:item.orderId}:{}),...(item.sessionId?{sessionId:item.sessionId}:{}),topupId:",1)
old="action:item.type==='driver_review_changed'?'refresh_profile':'open_wallet'";assert worker.count(old)==1
worker=worker.replace(old,"action:item.type==='support_reply'?'open_support':item.type==='driver_review_changed'?'refresh_profile':'open_wallet'",1)
jobs={
'wizzcentral-notifications-staging-pushSendOrderUpdate':{'src/handlers/push-order-update.js':(root/'backend/src/handlers/push-order-update.js').read_bytes(),'src/utils/customer-inbox.js':helper},
'wizzcentral-notifications-staging-pushAdminSendTest':{'src/handlers/campaign-push-worker.js':(root/'backend/src/handlers/campaign-push-worker.js').read_bytes(),'src/utils/customer-inbox.js':helper},
'wizzcentral-websocket-staging-liveChatMessage':{'src/handlers/websocket-connections.js':m.patch(source.read_text()).encode(),'src/utils/customer-inbox.js':helper},
'staging-wizz-wallet-service':{'dist/customerNotifications.js':(root/'backend/wallet-service/dist/customerNotifications.js').read_bytes()},
'staging-wizz-wallet-notification-worker':{'index.js':worker.encode()},
}
configs={};manifest=[]
for name,patches in jobs.items():
 original=(temp/(name+'.zip')).read_bytes();c=aws('lambda','get-function-configuration','--function-name',name)
 if c['CodeSha256']!=digest(original):raise RuntimeError('Concurrent release '+name)
 configs[name]=c;output=temp/(name+'-494.zip')
 with zipfile.ZipFile(io.BytesIO(original)) as z,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
  for item in z.infolist():
   if item.filename not in patches:target.writestr(item,z.read(item.filename))
  for k,v in patches.items():target.writestr(k,v)
 with zipfile.ZipFile(io.BytesIO(original)) as old,zipfile.ZipFile(output) as new:
  changed=[k for k in set(old.namelist())|set(new.namelist()) if k not in old.namelist() or k not in new.namelist() or old.read(k)!=new.read(k)]
  assert set(changed)<=set(patches)
 manifest.append({'function':name,'before':digest(original),'after':digest(output.read_bytes()),'changed':changed})
(temp/'manifest-494.json').write_text(json.dumps(manifest,indent=2))
if '--publish' not in __import__('sys').argv:
 print(json.dumps(manifest,indent=2));raise SystemExit()
# New permissions only permit CN-prefixed inbox records, never money writes.
policy=json.loads((root/'backend/customer-inbox-494-policy.json').read_text())
aws('iam','put-role-policy','--role-name',configs['wizzcentral-notifications-staging-pushSendOrderUpdate']['Role'].split('/')[-1],'--policy-name','CustomerInbox494','--policy-document',json.dumps(policy))
aws('iam','put-role-policy','--role-name',configs['wizzcentral-websocket-staging-liveChatMessage']['Role'].split('/')[-1],'--policy-name','CustomerReplyInbox494','--policy-document',json.dumps({'Version':'2012-10-17','Statement':[policy['Statement'][0]]}))
# Reader/worker precede producers. Revision preconditions prevent overwriting parallel releases.
for name in ['staging-wizz-wallet-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendOrderUpdate','wizzcentral-notifications-staging-pushAdminSendTest','wizzcentral-websocket-staging-liveChatMessage']:
 c=aws('lambda','update-function-code','--function-name',name,'--revision-id',configs[name]['RevisionId'],'--zip-file','fileb://'+str(temp/(name+'-494.zip')))
 if c['CodeSha256']!=digest((temp/(name+'-494.zip')).read_bytes()):raise RuntimeError('Hash mismatch '+name)
 subprocess.check_call(['aws','lambda','wait','function-updated-v2','--function-name',name,*common])
 print(json.dumps({'function':name,'sha256':c['CodeSha256'],'published':True}),flush=True)
