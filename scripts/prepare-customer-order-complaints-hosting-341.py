from pathlib import Path
import zipfile,copy,json,hashlib,runpy
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/customer-complaints-341');base=Path('/private/tmp/dispatch-followup-340/hosting-final.zip')
receipt=json.loads((R/'docs/dispatch-followup-publication-340.json').read_text());assert receipt['durableRestartFix']['hosting']['jobId']=='219'
files=['customer-order-complaint.js','customer-order-complaint.css','pages/customer-order-complaint.html','order-exception-cases.js','pages/order-exceptions.html','pages/support.html'];changes={n:(R/'frontend'/n).read_bytes()for n in files};old=zipfile.ZipFile(base);changes['pages/support.html']=runpy.run_path(str(R/'scripts/support-complaint-link-341.py'))['patch'](old.read('pages/support.html').decode()).encode();candidate=P/'hosting-candidate.zip'
with zipfile.ZipFile(candidate,'w')as dst:
 for info in old.infolist():dst.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
 for n,data in changes.items():
  if n not in old.namelist():dst.writestr(n,data)
with zipfile.ZipFile(candidate)as dst:assert all(old.read(n)==dst.read(n)for n in old.namelist()if n not in changes)
review={'part':341,'baseJob':'219','baseArtifactSHA256':hashlib.sha256(base.read_bytes()).hexdigest(),'candidateSHA256':hashlib.sha256(candidate.read_bytes()).hexdigest(),'changedFiles':files,'sourceHashes':{n:hashlib.sha256((R/'frontend'/n).read_bytes()).hexdigest()for n in files},'candidateEntryHashes':{n:hashlib.sha256(data).hexdigest()for n,data in changes.items()},'baseChangedFileHashes':{n:hashlib.sha256(old.read(n)).hexdigest()for n in files if n in old.namelist()},'unrelatedEntriesPreserved':True,'publishedCaseWorkflowVersionReferencesPreserved':True}
(P/'hosting-review.json').write_text(json.dumps(review,indent=2)+'\n');print('PASS hosting candidate ready, unrelated entries preserved')
