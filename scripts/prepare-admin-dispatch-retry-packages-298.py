from pathlib import Path
import zipfile,subprocess,json,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/admin-dispatch-retry-298'
report=[]
for q in sorted(P.iterdir()):
 if not q.is_dir() or not (q/'base.zip').exists() or q.name=='wizzcentral-notifications-staging-pushSendWaveOffer':continue
 z=zipfile.ZipFile(q/'base.zip');changes={};patched=[]
 for name in z.namelist():
  if not name.endswith('.js') or 'node_modules/' in name:continue
  raw=z.read(name)
  if b'backend/wallet-service/src/' not in raw and b'function dispatchOfferSK(' not in raw:continue
  local=q/'source'/name;local.parent.mkdir(parents=True,exist_ok=True);local.write_bytes(raw)
  result=json.loads(subprocess.check_output(['node','scripts/patch-admin-dispatch-retry-functions-298.cjs',str(local),name],cwd=R))
  out=Path(str(local)+'.patched').read_bytes()
  if result['functions']:
   changes[name]=out;patched.append(result)
 # Existing scheduled host entry is a controlled delegate; retain the rest of the worker.
 if q.name=='staging-cod-integration':
  s=changes.get('index.js',z.read('index.js')).decode()
  s=s.replace('"SAFE_FINANCIAL_INITIAL_RETRY"].includes(process.env.DISPATCH_REVIEW_EXECUTION_MODE', '"SAFE_FINANCIAL_INITIAL_RETRY", "SAFE_FINANCIAL_RETRY"].includes(process.env.DISPATCH_REVIEW_EXECUTION_MODE')
  assert s.count('require("./dispatch-review-host-238.js").handler')==1
  s=s.replace('require("./dispatch-review-host-238.js").handler','require("./dispatch-review-host-298.js").handler')
  changes['index.js']=s.encode();changes['dispatch-review-host-298.js']=(P/'dispatch-review-host-298.js').read_bytes()
 if not changes:continue
 changes['admin-retry-runtime-298.js']=(P/'admin-retry-runtime-298.js').read_bytes()
 for name,data in changes.items():
  local=q/'candidate-files'/name;local.parent.mkdir(parents=True,exist_ok=True);local.write_bytes(data)
  subprocess.run(['node','--check',str(local)],check=True,capture_output=True)
 with zipfile.ZipFile(q/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for name,data in changes.items():
   if name not in z.namelist():out.writestr(name,data)
 zz=zipfile.ZipFile(q/'candidate.zip');assert all(z.read(n)==zz.read(n) for n in z.namelist() if n not in changes)
 cfg=json.loads((q/'config.private.json').read_text());sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
 assert sha((q/'base.zip').read_bytes())==cfg['CodeSha256']
 item={'name':q.name,'baseHash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'hash':sha((q/'candidate.zip').read_bytes()),'changedFiles':list(changes),'delegatedFunctions':patched,'unchangedEntriesVerified':True,'configurationChanged':False}
 report.append(item);print(q.name,len(changes),'entries',sum(len(x['functions']) for x in patched),'delegates',flush=True)
 (P/'packages.json').write_text(json.dumps(report,indent=2)+'\n')
