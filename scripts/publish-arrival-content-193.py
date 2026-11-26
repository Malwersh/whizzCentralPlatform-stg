"""Only replace the canonical Live Activity display mapper; no credentials or data changes."""
import pathlib,json,subprocess,urllib.request,zipfile,copy,hashlib,base64
p=pathlib.Path('/private/tmp/user-tracking-193');b=pathlib.Path('backend/src/handlers/order-arrival-content.js').read_bytes();rows=[]
def aws(*a):return json.loads(subprocess.check_output(['aws',*a,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json']))
for n in ['wizzcentral-notifications-staging-pushSendOrderUpdate','wizzcentral-notifications-staging-liveActivityPushUpdate','wizzcentral-notifications-staging-liveActivityPushEnd']:
 x=aws('lambda','get-function','--function-name',n);before=x['Configuration'];f=p/(n+'.private.json');f.write_text(json.dumps(before));f.chmod(0o600);old=p/(n+'.zip')
 for attempt in range(3):
  try:urllib.request.urlretrieve(x['Code']['Location'],old);break
  except Exception:
   if attempt==2:raise
 z=zipfile.ZipFile(old);target='src/handlers/order-arrival-content.js';assert target in z.namelist()
 if z.read(target)!=b:
  candidate=p/(n+'.candidate.zip')
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
   for e in z.infolist():out.writestr(copy.copy(e),b if e.filename==target else z.read(e.filename))
  with zipfile.ZipFile(candidate) as out:assert all(out.read(f)==z.read(f) for f in z.namelist() if f!=target)
  aws('lambda','update-function-code','--function-name',n,'--revision-id',before['RevisionId'],'--zip-file','fileb://'+str(candidate));subprocess.run(['aws','lambda','wait','function-updated-v2','--function-name',n,'--profile','Wizz_stg_UserApp','--region','us-east-1'],check=True);after=aws('lambda','get-function-configuration','--function-name',n);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode();assert all(after.get(k)==before.get(k) for k in ['Environment','Role','Handler','MemorySize','Timeout','Runtime'])
 else:after=before
 rows.append({'name':n,'onlyArrivalContentChanged':True,'configurationPreserved':True,'codeSha256':after['CodeSha256']});(p/'activity-published.json').write_text(json.dumps(rows,indent=2))
print(json.dumps(rows))
