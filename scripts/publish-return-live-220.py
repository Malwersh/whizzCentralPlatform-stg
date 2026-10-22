"""Canonical return display and stream predicate only; no APNs sends, events or money writes."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-live-220');l=session().client('lambda');receipt={'part':220,'status':'PUBLISHING','functions':[],'dataWrites':False,'notificationPushesRequested':False,'permissionsChanged':False};doc=root/'docs/return-live-publication-220.json'
def save():doc.write_text(json.dumps(receipt,indent=2)+'\n')
sets=[(n,{'src/handlers/order-arrival-content.js':(root/'backend/src/handlers/order-arrival-content.js').read_bytes()}) for n in ['wizzcentral-notifications-staging-pushSendOrderUpdate','wizzcentral-notifications-staging-liveActivityPushUpdate','wizzcentral-notifications-staging-liveActivityPushEnd']];sets.append(('WaveSystem_CreateDispatchJob',{'order-activity-stream.js':(root/'backend/src/handlers/order-activity-stream.js').read_bytes()}))
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for name,changes in sets:
 before=json.loads((p/(name+'.config.private.json')).read_text());current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==before['RevisionId'] and current['CodeSha256']==before['CodeSha256'],'LIVE_DRIFT '+name
 candidate=p/(name+'.candidate.zip')
 with zipfile.ZipFile(p/(name+'.zip')) as old:
  assert sha((p/(name+'.zip')).read_bytes())==before['CodeSha256'];assert all(n in old.namelist() for n in changes)
  # Require the real entry to reference the mapper/forwarder rather than a dead package copy.
  if name=='WaveSystem_CreateDispatchJob':assert "require('./order-activity-stream').forward" in old.read('index.js').decode()
  else:
   entry=before['Handler'].rsplit('.',1)[0]+'.js';assert 'order-arrival-content' in old.read(entry).decode()
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  with zipfile.ZipFile(candidate) as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 raw=candidate.read_bytes();l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(90):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==sha(raw)
 for k in ['Runtime','Handler','Role','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage','Environment']:assert after.get(k)==before.get(k),'CONFIG_DRIFT '+k
 receipt['functions'].append({'name':name,'codeSha256':sha(raw),'changedFiles':list(changes),'otherFilesAndConfigurationPreserved':True});save();print('Published '+name,flush=True)
receipt['status']='PUBLISHED_VERIFIED';save()
