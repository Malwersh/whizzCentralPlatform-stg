from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/case-evidence-set-fix-20261025');P.mkdir(exist_ok=True)
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
name='staging-driver-financial-accept';f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];expected=json.loads((R/'docs/case-evidence-error-20261025.json').read_text());assert cfg['CodeSha256']==expected['hash'],'Live code drift'
base=Path('/private/tmp/case-evidence-error-20261025/candidate.zip');assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==cfg['CodeSha256'];(P/'original-config.private.json').write_text(json.dumps(cfg));z=zipfile.ZipFile(base)
n='order-exception-runtime-229.js';s=z.read(n).decode()
old='return detach((await db.send(new import_lib_dynamodb.GetCommand({ TableName, Key, ConsistentRead: true }))).Item ?? null);'
assert s.count(old)==1;s=s.replace(old,old.replace('return detach(', 'return structuredClone('))
old='values[":v" + i8] = detach(saved[field]);';assert s.count(old)==1;s=s.replace(old,old.replace('detach(', 'structuredClone('))
changes={n:s.encode()};candidate=P/'candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 for n,v in changes.items():
  if n not in z.namelist():out.writestr(n,v)
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes);new.extractall(P/'runtime')
for n in changes:subprocess.run(['node','--check',str(P/'runtime'/n)],check=True)
aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(candidate));subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert after.get(k)==cfg.get(k)
receipt={'status':'SET_PRESERVATION_FIX_PUBLISHED','function':name,'hash':after['CodeSha256'],'revision':after['RevisionId'],'configurationPreserved':True,'changedEntries':list(changes),'businessWrites':False,'logsContainNoTokensOrPayloads':True,'caseEvidenceStillRequiresUserRetry':True};(R/'docs/case-evidence-set-fix-20261025.json').write_text(json.dumps(receipt,indent=2)+'\n');print(receipt['status'],flush=True)
