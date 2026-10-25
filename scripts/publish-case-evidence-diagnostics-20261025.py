from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/case-evidence-error-20261025');P.mkdir(exist_ok=True)
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
name='staging-driver-financial-accept';f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];expected=json.loads((R/'docs/driver-quality-self-service-publication-290.json').read_text());prior=next(x for x in expected['functions']if x['function']==name);assert cfg['CodeSha256']==prior['hash'],'Live code drift'
base=Path('/private/tmp/driver-quality-self-service-290/financial-candidate.zip');assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==cfg['CodeSha256'];(P/'original-config.private.json').write_text(json.dumps(cfg));z=zipfile.ZipFile(base);s=z.read('index.js').decode();a=s.index('async function financialAcceptanceHandler(');needle='const candidate = error?.code ?? error?.message;';b=s.index(needle,a);s=s[:b]+"if(event?.action==='exception_case_admin')require('./case-evidence-diagnostics-20261025.js').report(error,event.body?.action);\n        "+s[b:]
changes={'index.js':s.encode(),'case-evidence-diagnostics-20261025.js':(R/'backend/shared/case-evidence-diagnostics-20261025.js').read_bytes()};candidate=P/'candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for n,v in changes.items():
  if n not in z.namelist():out.writestr(n,v)
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes);new.extractall(P/'runtime')
for n in changes:subprocess.run(['node','--check',str(P/'runtime'/n)],check=True)
aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(candidate));subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert after.get(k)==cfg.get(k)
receipt={'status':'SAFE_DIAGNOSTICS_PUBLISHED','function':name,'hash':after['CodeSha256'],'revision':after['RevisionId'],'configurationPreserved':True,'changedEntries':list(changes),'businessWrites':False,'logsContainNoTokensOrPayloads':True,'caseEvidenceStillRequiresUserRetry':True};(R/'docs/case-evidence-error-20261025.json').write_text(json.dumps(receipt,indent=2)+'\n');print(receipt['status'],flush=True)
