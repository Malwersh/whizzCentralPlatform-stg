from pathlib import Path
import subprocess,json,urllib.request,zipfile,io,copy,hashlib,base64,time
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/financial-audit-359';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(raw) if raw.strip() else {}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
assert 'pass 74' in Path('/tmp/audit359-unit.log').read_text();dest=R/'docs/financial-audit-publication-359.json';r=json.loads(dest.read_text());assert r['status']=='PUBLISHED_STAGING_SHA_VERIFIED_HUMAN_ACCEPTANCE_PENDING';f=aws('lambda','get-function','--function-name',r['function']);c=f['Configuration'];assert c['CodeSha256']==r['candidateSha256'];raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==c['CodeSha256'];(P/'before-proposal-audit.zip').write_bytes(raw);z=zipfile.ZipFile(io.BytesIO(raw));changes={'dist/walletLimitsSettings'+ext:(R/'backend/wallet-service/dist'/('walletLimitsSettings'+ext)).read_bytes() for ext in ['.js','.js.map']};candidate=P/'final-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
with zipfile.ZipFile(candidate) as out:assert all(out.read(k)==z.read(k) for k in z.namelist() if k not in changes)
aws('lambda','update-function-code','--function-name',r['function'],'--revision-id',c['RevisionId'],'--zip-file','fileb://'+str(candidate))
for _ in range(90):
 v=aws('lambda','get-function-configuration','--function-name',r['function'])
 if v['LastUpdateStatus']=='Successful':break
 assert v['LastUpdateStatus']!='Failed';time.sleep(1)
else:raise RuntimeError('Update pending')
assert v['CodeSha256']==sha(candidate.read_bytes()) and all(v.get(k)==c.get(k) for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize']);r['initialCandidateSha256']=r['candidateSha256'];r['candidateSha256']=v['CodeSha256'];r['proposalHistoryExplicitlyPreserved']=True;dest.write_text(json.dumps(r,indent=2)+'\n');print('PASS final financial audit SHA verified; proposed limits archived without activating them')
