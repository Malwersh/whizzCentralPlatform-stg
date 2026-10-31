"""Narrow appeal completion to the merchant's own financial review only."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,base64,time
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-353';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];name='staging-wizz-staff-service'
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
p=R/'docs/post-payout-correction-publication-353.json';r=json.loads(p.read_text());assert r['status']=='BACKEND_PUBLISHED_VERIFIED_HUMAN_ACCEPTANCE_OPEN';f=aws('lambda','get-function','--function-name',name);c=f['Configuration'];expected=next(x for x in r['functions'] if x['name']==name);assert c['CodeSha256']==expected['codeSha256'],'LIVE_DRIFT'
raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));file='merchant-correction-cases.js';data=(R/'backend/staff-service'/file).read_bytes();candidate=O/'case-owner-scope.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),data if info.filename==file else z.read(info.filename))
with zipfile.ZipFile(candidate) as out:assert all(out.read(k)==z.read(k) for k in z.namelist() if k!=file)
aws('lambda','update-function-code','--function-name',name,'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(candidate))
for _ in range(90):
 fresh=aws('lambda','get-function-configuration','--function-name',name)
 if fresh['LastUpdateStatus']=='Successful':break
 assert fresh['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Scope patch pending')
assert fresh['CodeSha256']==sha(candidate.read_bytes());assert all(fresh.get(k)==c.get(k) for k in ['Environment','Role','Handler','Runtime','Timeout','Layers'])
expected['codeSha256']=fresh['CodeSha256'];r['merchantAppealScopeVerified']=True;r['scopePatchOtherEntriesPreserved']=True;p.write_text(json.dumps(r,ensure_ascii=False,indent=2)+'\n');print('PASS merchant-only appeal scope SHA verified')
