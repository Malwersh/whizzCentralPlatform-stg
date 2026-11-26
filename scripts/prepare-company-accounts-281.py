"""Prepare bounded staff/hosting overlays; never modifies business data."""
import sys,pathlib,json,zipfile,copy,urllib.request,hashlib,subprocess,difflib
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/company-accounts-281');p.mkdir(exist_ok=True)
s=session();l=s.client('lambda');a=s.client('amplify');f=l.get_function(FunctionName='staging-wizz-staff-service');(p/'staff-base.zip').write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read())
subprocess.run([str(r/'backend/wallet-service/node_modules/.bin/esbuild'),str(r/'backend/staff-service/company-accounts.js'),'--bundle','--platform=node','--target=node22','--keep-names','--outfile='+str(p/'company-accounts-281.js')],check=True)
files={'company-accounts-281.js':(p/'company-accounts-281.js').read_bytes()}
with zipfile.ZipFile(p/'staff-base.zip') as old:
 target='_discount_review/central-staff/index.js'
 index=old.read(target).decode();needle='    if (path === "/staff/order-exceptions"';assert index.count(needle)==1
 line='    if (path === "/staff/company-accounts") return response(200, await require("../../company-accounts-281.js").route({db,table,employee,guard,audit,enrolled,recent,claims,allowed,query:event.queryStringParameters,deadline:Date.now()+22000},actor,method,path,input));'
 if '/staff/company-accounts' in index:
  assert index.count(line)==1
  files[target]=index.encode()
 else:files[target]=index.replace(needle,line+'\n'+needle,1).encode()
 with zipfile.ZipFile(p/'staff-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),files.get(info.filename,old.read(info.filename)))
  for n,raw in files.items():
   if n not in old.namelist():out.writestr(n,raw)
 with zipfile.ZipFile(p/'staff-candidate.zip') as new:assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in files)
base=a.list_jobs(appId='d2vmebm1e1n95m',branchName='staging',maxResults=1)['jobSummaries'][0];assert base['status']=='SUCCEED';job=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=base['jobId'])['job'];url=next(x['artifactsUrl'] for x in job['steps'] if x.get('artifactsUrl'));(p/'hosting-base.zip').write_bytes(urllib.request.urlopen(url,timeout=90).read())
changes={n:(r/'frontend'/n).read_bytes() for n in ['pages/financial-management.html','company-accounts.js','styles/company-accounts.css']}
# Apply only the reviewed local diff to shared navigation and wallet pages,
# preserving any unrelated live edits rather than replacing those whole files.
with zipfile.ZipFile(p/'hosting-base.zip') as old:
 for n in ['assets/js/navigation.js','assets/js/rbac.js','includes/sidebar.html','pages/finance.html']:
  before=subprocess.check_output(['git','show','HEAD:frontend/'+n],cwd=r).decode();after=(r/'frontend'/n).read_text();live=old.read(n).decode();blocks=list(difflib.SequenceMatcher(None,before.splitlines(True),after.splitlines(True),autojunk=False).get_opcodes())
  for tag,i,j,k,m in reversed(blocks):
   if tag=='equal':continue
   original=''.join(before.splitlines(True)[i:j]);replacement=''.join(after.splitlines(True)[k:m])
   if replacement and replacement in live:continue
   if tag=='insert':
    anchor=''.join(before.splitlines(True)[i:i+1]);assert anchor and live.count(anchor)==1,n;live=live.replace(anchor,replacement+anchor,1)
   else:assert live.count(original)==1,n;live=live.replace(original,replacement,1)
  changes[n]=live.encode()
 removed=['financial-management.js'] if 'financial-management.js' in old.namelist() else []
 with zipfile.ZipFile(p/'hosting-candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():
   if info.filename not in removed:out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for n,raw in changes.items():
   if n not in old.namelist():out.writestr(n,raw)
 with zipfile.ZipFile(p/'hosting-candidate.zip') as new:assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes and n not in removed)
record={'part':281,'status':'PREPARED','baseStaffCodeSha256':f['Configuration']['CodeSha256'],'staffRole':f['Configuration']['Role'],'baseHostingJobId':base['jobId'],'staffFiles':list(files),'hostingFiles':list(changes),'removedHostingFiles':removed,'unrelatedEntriesPreserved':True,'staffCandidateSha256':hashlib.sha256((p/'staff-candidate.zip').read_bytes()).hexdigest(),'hostingCandidateSha256':hashlib.sha256((p/'hosting-candidate.zip').read_bytes()).hexdigest()}
(p/'prepared.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
