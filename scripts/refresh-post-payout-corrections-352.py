from pathlib import Path
import json,zipfile,subprocess,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-352'
script="require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],platform:'node',target:'node20',bundle:true,external:['@aws-sdk/*'],nodePaths:[process.argv[4]],keepNames:true,logLevel:'warning'})"
subprocess.run(['node','-e',script,str(R/'backend/wallet-service/node_modules/esbuild'),str(O/'entry.ts'),str(O/'merchant-payout-corrections-352.js'),str(R/'backend/wallet-service/node_modules')],check=True)
manifest=json.loads((O/'manifest.private.json').read_text())
for m in manifest:
 if m['name']=='staging-account-deletion-worker':
  old=zipfile.ZipFile(O/m['name']/'before.zip');data=(R/'backend/account-deletion/payout-retention.js').read_bytes()
  with zipfile.ZipFile(m['candidate'],'w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),data if info.filename=='payout-retention.js' else old.read(info.filename))
  m['candidateSha256']=base64.b64encode(hashlib.sha256(Path(m['candidate']).read_bytes()).digest()).decode();continue
 if m['name']!='staging-wizz-staff-service':continue
 folder=O/m['name'];old=zipfile.ZipFile(folder/'before.zip');changes={'merchant-payout-corrections-352.js':(O/'merchant-payout-corrections-352.js').read_bytes()};patches={}
 for file in ['merchant-corrections.js','merchant-payouts.js','settlement-schedules.js','commercial-owner.js','merchant-account.js','company-accounting.js','company-accounts.js','company-chart.js']:changes[file]=(R/'backend/staff-service'/file).read_bytes()
 for file in m['functionPatches']:
  src=folder/'ast-input.js';dest=folder/'ast-output.js';report=folder/'ast-report.json';src.write_bytes(old.read(file));subprocess.run(['node',str(R/'scripts/patch-payout-correction-functions-352.cjs'),str(src),str(dest),str(report)],check=True);changes[file]=dest.read_bytes();patches[file]=json.loads(report.read_text())
 changes={k:v for k,v in changes.items() if k not in old.namelist() or old.read(k)!=v}
 for file,data in changes.items():p=folder/'check'/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);subprocess.run(['node','--check',str(p)],check=True)
 with zipfile.ZipFile(m['candidate'],'w',zipfile.ZIP_DEFLATED) as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for k,v in changes.items():
   if k not in old.namelist():out.writestr(k,v)
 with zipfile.ZipFile(m['candidate']) as out:assert all(old.read(k)==out.read(k) for k in old.namelist() if k not in changes)
 m['candidateSha256']=base64.b64encode(hashlib.sha256(Path(m['candidate']).read_bytes()).digest()).decode();m['changedFiles']=list(changes);m['functionPatches']={k:v['functions'] for k,v in patches.items()};(folder/'function-patches.json').write_text(json.dumps(patches,indent=2));print('Refreshed',m['name'],'actual bundled routes retained and delegated',flush=True)
(O/'manifest.private.json').write_text(json.dumps(manifest,indent=2))
