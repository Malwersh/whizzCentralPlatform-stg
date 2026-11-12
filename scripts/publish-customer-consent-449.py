"""Capture and patch only consent-related files in five staging packages."""
import pathlib,json,subprocess,zipfile,hashlib,base64,io,urllib.request,argparse
parser=argparse.ArgumentParser();parser.add_argument('--publish',action='store_true');args=parser.parse_args()
root=pathlib.Path(__file__).resolve().parents[1];user=root.parent/'wizzuser-stg';temp=pathlib.Path('/private/tmp/account449');temp.mkdir(exist_ok=True,mode=0o700)
common=['--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*args):
 data=subprocess.check_output(['aws',*args,*common]);return json.loads(data) if data.strip() else {}
def digest(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
consent=(user/'backend/src/functions/shared/customer-promotion-consent-449.js').read_bytes()
if consent!=(root/'backend/src/handlers/customer-promotion-consent-449.js').read_bytes():raise RuntimeError('Consent source mismatch')
guard=(user/'backend/src/functions/create-order/account-guard.js').read_bytes()
get=(user/'backend/src/functions/get-user-profile/index.js').read_text().replace("require('../create-order/account-guard')","require('./account-guard')").replace("require('../shared/customer-promotion-consent-449')","require('./customer-promotion-consent-449')").encode()
shared={'functions/shared/customer-promotion-consent-449.js':consent,'functions/create-order/account-guard.js':guard}
push={'src/handlers/customer-notification-preferences-448.js':(root/'backend/src/handlers/customer-notification-preferences-448.js').read_bytes(),'src/handlers/customer-promotion-consent-449.js':consent}
jobs={
 'WizzUser-GetUserProfile-staging':{'index.js':get,'account-guard.js':guard,'customer-promotion-consent-449.js':consent},
 'WizzUser-UpdateUserProfile-staging':{**shared,'functions/update-user-profile/index.js':(user/'backend/src/functions/update-user-profile/index.js').read_bytes()},
 'WizzUser-UpdateUserPreferences-staging':{**shared,'functions/update-user-preferences/index.js':(user/'backend/src/functions/update-user-preferences/index.js').read_bytes(),'functions/update-user-preferences/notification-settings.js':(user/'backend/src/functions/update-user-preferences/notification-settings.js').read_bytes()},
 'wizzcentral-notifications-staging-pushAdminSendTest':push,
 'wizzcentral-notifications-staging-pushSendOrderUpdate':push,
}
configs={}
for name,patches in jobs.items():
 c=aws('lambda','get-function','--function-name',name);config=c['Configuration'];configs[name]={'RevisionId':config['RevisionId'],'CodeSha256':config['CodeSha256']}
 original=urllib.request.urlopen(c['Code']['Location']).read()
 if digest(original)!=config['CodeSha256']:raise RuntimeError('Captured package mismatch')
 (temp/(name+'-before.zip')).write_bytes(original)
 with zipfile.ZipFile(io.BytesIO(original)) as source,zipfile.ZipFile(temp/(name+'-449.zip'),'w',zipfile.ZIP_DEFLATED) as target:
  for item in source.infolist():
   if item.filename not in patches:target.writestr(item,source.read(item.filename))
  for key,value in patches.items():target.writestr(key,value)
(temp/'captured-revisions.json').write_text(json.dumps(configs))
print('Prepared five staging packages; no customer records changed')
if args.publish:
 # Refuse a concurrent release before changing IAM or code.
 for name,c in configs.items():
  if aws('lambda','get-function-configuration','--function-name',name)['RevisionId']!=c['RevisionId']:raise RuntimeError('Concurrent deployment: '+name)
 aws('iam','put-role-policy','--role-name','wizzcentral-notifications-staging-us-east-1-lambdaRole','--policy-name','CustomerNotificationPreferences448','--policy-document','file://'+str(root/'backend/customer-notification-preferences-448-policy.json'))
 for name,c in configs.items():
  archive=temp/(name+'-449.zip');result=aws('lambda','update-function-code','--function-name',name,'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(archive))
  if digest(archive.read_bytes())!=result['CodeSha256']:raise RuntimeError('Published package mismatch')
  print(json.dumps({'function':name,'codeSha256':result['CodeSha256'],'status':result['LastUpdateStatus']}))
