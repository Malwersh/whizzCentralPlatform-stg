"""Overlay direct-write changes on captured Staging packages; preserve unrelated live files."""
import pathlib,json,zipfile,copy,hashlib,base64,difflib
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance65')
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def replace(s,a,b):
 assert s.count(a)==1,'UNEXPECTED_BASE '+a[:70]
 return s.replace(a,b)
def main():
 report={'part':65,'environment':'Staging','packages':{},'sourceHashes':{},'financialActivationPerformed':False}
 groups={'staff':['index.js','catalog.js','delivery-pricing.js','commercial-management.js','operational-settings.js','invitations.js','account-deletion.js','write-workflow.js'],'wallet':['dist/transferSettings.js','dist/staffAccess.js','dist/writeWorkflow.js'],'authorizer':['staff_policy.py']}
 for kind,paths in groups.items():
  changes={}
  for n in paths:
   src=ROOT/'backend'/'staff-service'/n if kind=='staff' else ROOT/'backend'/'wallet-service'/('authorizer_lambda' if kind=='authorizer' else '')/n
   changes[n]=src.read_bytes();report['sourceHashes'][str(src.relative_to(ROOT))]=hashlib.sha256(changes[n]).hexdigest()
  with zipfile.ZipFile(OUT/(kind+'.zip')) as old:
   if kind=='wallet':
    # Only modify approval coordination. Existing unpublished employee-transfer changes stay local.
    s=old.read('dist/transferService.js').decode();s=replace(s,'const transferVerification_1 =', 'const writeWorkflow_1 = require("./writeWorkflow");\nconst transferVerification_1 =')
    s=replace(s,"if (actor.type !== 'FINANCE')\n        return execute(operation, actor, false);", "if (actor.type !== 'FINANCE' || (0, writeWorkflow_1.directWrite)())\n        return execute(operation, actor, false);")
    s=replace(s,"if (operation.requestedBy === actor.id)","if (!(0, writeWorkflow_1.directWrite)() && operation.requestedBy === actor.id)")
    s=replace(s,"const approver = approval ? await (0, staffAccess_1.financialStaff)(actor.id, 'finance.approve') : undefined;", "const approver = approval || actor.type === 'FINANCE' ? await (0, staffAccess_1.financialStaff)(actor.id, approval ? 'finance.approve' : 'finance.request') : undefined;")
    s=replace(s,"...(requester ? [(0, staffAccess_1.staffGuard)(requester)] : [])", "...(requester && o.requestedBy !== actor.id ? [(0, staffAccess_1.staffGuard)(requester)] : [])")
    s=replace(s,"ConditionExpression: '#s = :pending AND requestedBy <> :actor AND expiresAt > :time AND createdAt > :oldest'", "ConditionExpression: `#s = :pending AND ${(0, writeWorkflow_1.directWrite)() ? '' : 'requestedBy <> :actor AND '}expiresAt > :time AND createdAt > :oldest`")
    changes['dist/transferService.js']=s.encode()
   for n,data in changes.items():
    if n in old.namelist():
     diff=list(difflib.unified_diff(old.read(n).decode().splitlines(),data.decode().splitlines(),n,n,n=2));(OUT/(kind+'-'+n.replace('/','-')+'.candidate.diff')).write_text('\n'.join(diff));assert len(diff)<220,'REVIEW_LARGE_DIFF '+n
   with zipfile.ZipFile(OUT/(kind+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as new:
    for info in old.infolist():new.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
    for n,data in changes.items():
     if n not in old.namelist():new.writestr(n,data)
   with zipfile.ZipFile(OUT/(kind+'.candidate.zip')) as new:assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
   report['packages'][kind]={'codeSha256':sha((OUT/(kind+'.candidate.zip')).read_bytes()),'changedFiles':list(changes),'preservedFiles':sum(n not in changes for n in old.namelist())}
 (OUT/'preparation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report['packages']))
if __name__=='__main__':main()
