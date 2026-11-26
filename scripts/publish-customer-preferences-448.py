"""Patch only the downloaded staging packages; abort if another release changed them."""
import pathlib,json,subprocess,zipfile,hashlib,base64,io
root=pathlib.Path(__file__).resolve().parents[1];user=root.parent/'wizzuser-stg';temp=pathlib.Path('/private/tmp/account448')
common=['--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 data=subprocess.check_output(['aws',*args,*common]);return json.loads(data) if data.strip() else {}
def digest(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
helper=(root/'backend/src/handlers/customer-notification-preferences-448.js').read_bytes()
jobs={
'WizzUser-UpdateUserPreferences-staging':{
 'functions/shared/customer-promotion-consent-449.js':(user/'backend/src/functions/shared/customer-promotion-consent-449.js').read_bytes(),
 'functions/update-user-preferences/index.js':(user/'backend/src/functions/update-user-preferences/index.js').read_bytes(),
 'functions/update-user-preferences/notification-settings.js':(user/'backend/src/functions/update-user-preferences/notification-settings.js').read_bytes(),
 'functions/create-order/account-guard.js':(user/'backend/src/functions/create-order/account-guard.js').read_bytes()},
'wizzcentral-notifications-staging-pushAdminSendTest':{
 'src/handlers/campaign-push-worker.js':(root/'backend/src/handlers/campaign-push-worker.js').read_bytes(),
 'src/handlers/customer-promotion-consent-449.js':(root/'backend/src/handlers/customer-promotion-consent-449.js').read_bytes(),
 'src/handlers/customer-notification-preferences-448.js':helper},
'wizzcentral-notifications-staging-pushSendOrderUpdate':{
 'src/handlers/push-order-update.js':(temp/'wizzcentral-notifications-staging-pushSendOrderUpdate/src/handlers/push-order-update.js').read_bytes(),
 'src/handlers/customer-promotion-consent-449.js':(root/'backend/src/handlers/customer-promotion-consent-449.js').read_bytes(),
 'src/handlers/customer-notification-preferences-448.js':helper}}
configs={}
for name,patches in jobs.items():
 original=(temp/(name+'.zip')).read_bytes();c=aws('lambda','get-function-configuration','--function-name',name)
 if c['CodeSha256']!=digest(original):raise RuntimeError('Concurrent release: '+name)
 configs[name]=c
 output=temp/(name+'-448.zip')
 with zipfile.ZipFile(io.BytesIO(original)) as source,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
  for item in source.infolist():
   if item.filename not in patches:target.writestr(item,source.read(item.filename))
  for key,value in patches.items():target.writestr(key,value)
# Minimal read projection only; no write or financial privileges.
aws('iam','put-role-policy','--role-name','wizzcentral-notifications-staging-us-east-1-lambdaRole','--policy-name','CustomerNotificationPreferences448','--policy-document','file://'+str(root/'backend/customer-notification-preferences-448-policy.json'))
for name in jobs:
 output=temp/(name+'-448.zip')
 c=aws('lambda','update-function-code','--function-name',name,'--revision-id',configs[name]['RevisionId'],'--zip-file','fileb://'+str(output))
 if c['CodeSha256']!=digest(output.read_bytes()):raise RuntimeError('Package mismatch')
 print(json.dumps({'function':name,'sha256':c['CodeSha256'],'status':c['LastUpdateStatus']}))
