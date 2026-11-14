from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/performance-hidden-20261025')
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
name='staging-wizz-staff-service';f=aws('lambda','get-function','--function-name',name);cfg=f['Configuration'];prior=json.loads((P/'config.private.json').read_text());assert cfg['CodeSha256']==prior['CodeSha256'],'Live code drift';assert cfg['Handler']=='index.handler'
base=P/'staff.zip';assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==cfg['CodeSha256'];z=zipfile.ZipFile(base);entry='_discount_review/central-staff/index.js';assert 'module.exports = require("./_discount_review/central-staff/index.js")'in z.read('index.js').decode()
from importlib.util import spec_from_file_location,module_from_spec
spec=spec_from_file_location('patch',R/'scripts/patch-performance-case-reader-20261025.py');module=module_from_spec(spec);spec.loader.exec_module(module);patched=module.patch(z.read(entry).decode());assert patched==(P/'patched-entry.js').read_text()
candidate=P/'staff-candidate.zip'
with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
 for info in z.infolist():out.writestr(copy.copy(info),patched.encode()if info.filename==entry else z.read(info.filename))
new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n!=entry)
subprocess.run(['node','--check',str(P/'patched-entry.js')],check=True);subprocess.run(['node','--test',str(R/'backend/staff-service/test-performance-case-reader-20261025.cjs')],check=True)
aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(candidate));subprocess.check_call(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1','lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function','--function-name',name);c=after['Configuration'];assert c['CodeSha256']==base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','MemorySize','Timeout']:assert c.get(k)==cfg.get(k)
assert urllib.request.urlopen(after['Code']['Location']).read()==candidate.read_bytes()
receipt={'status':'PUBLISHED_BYTE_VERIFIED','function':name,'hash':c['CodeSha256'],'changedEntries':[entry],'configPreserved':True,'allOtherEntriesIdentical':True,'businessWrites':0,'capturedActualModuleTests':3,'fix':'Actual bundled case reader now returns original assignment archives, prior performance decisions and performance events.'};(R/'docs/performance-case-reader-20261025.json').write_text(json.dumps(receipt,indent=2)+'\n');print(receipt['status'])
