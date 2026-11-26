"""Read live staging packages and prepare minimal overlays; no AWS mutation."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,base64,difflib,os
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-352';O.mkdir(parents=True,exist_ok=True)
B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(v):return base64.b64encode(hashlib.sha256(v).digest()).decode()
entry=O/'entry.ts';entry.write_text('export {createMerchantPayoutService,verifyMerchantPayoutJournal,readMerchantStatementPayment} from "'+str(R/'backend/wallet-service/src/merchantPayout')+'";')
script="const e=require(process.argv[1]);e.buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],platform:'node',target:'node20',bundle:true,external:['@aws-sdk/*'],nodePaths:[process.argv[4]],keepNames:true,logLevel:'warning'});"
subprocess.run(['node','-e',script,str(R/'backend/wallet-service/node_modules/esbuild'),str(entry),str(O/'merchant-payout-corrections-352.js'),str(R/'backend/wallet-service/node_modules')],check=True)
assert aws('sts','get-caller-identity')['Account']=='699561669180'
manifest=[]
for name in ['staging-wizz-staff-service','order-receiver-regional-staging-unified-auth-v4-sam','staging-account-deletion-worker']:
 folder=O/name;folder.mkdir(exist_ok=True);f=aws('lambda','get-function','--function-name',name);c=f['Configuration'];(folder/'config.private.json').write_text(json.dumps(c));os.chmod(folder/'config.private.json',0o600)
 raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==c['CodeSha256'];(folder/'before.zip').write_bytes(raw);z=zipfile.ZipFile(io.BytesIO(raw));changes={};patches={}
 if name=='staging-wizz-staff-service':
  changes['merchant-payout-corrections-352.js']=(O/'merchant-payout-corrections-352.js').read_bytes()
  for file in ['merchant-corrections.js','merchant-payouts.js','settlement-schedules.js','commercial-owner.js','merchant-account.js','company-accounting.js','company-accounts.js','company-chart.js']:
   changes[file]=(R/'backend/staff-service'/file).read_bytes()
  for file in z.namelist():
   if not file.endswith('.js') or 'node_modules/' in file:continue
   data=z.read(file)
   if not any(b'function '+n+b'(' in data for n in [b'createMerchantPayoutService',b'verifyMerchantPayoutJournal',b'readMerchantStatementPayment']):continue
   source=folder/'ast-input.js';dest=folder/'ast-output.js';report=folder/'ast-report.json';source.write_bytes(data)
   subprocess.run(['node',str(R/'scripts/patch-payout-correction-functions-352.cjs'),str(source),str(dest),str(report)],check=True)
   details=json.loads(report.read_text())
   if details['functions']:changes[file]=dest.read_bytes();patches[file]=details
 elif name=='order-receiver-regional-staging-unified-auth-v4-sam':
  # Preserve the current owner transport; extend only the safe error prefix.
  file='settlement_schedules.js';data=z.read(file);old=b'/^(PAYOUT_|SCHEDULE_';new=b'/^(CORRECTION_|PAYOUT_|SCHEDULE_';assert data.count(old)==1;changes[file]=data.replace(old,new)
 else:
  changes['payout-retention.js']=(R/'backend/account-deletion/payout-retention.js').read_bytes()
 changes={k:v for k,v in changes.items() if k not in z.namelist() or z.read(k)!=v}
 diffs=[]
 for file,data in changes.items():
  target=folder/'check'/file;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data);subprocess.run(['node','--check',str(target)],check=True)
  if file in z.namelist() and file not in patches:diffs.append(''.join(difflib.unified_diff(z.read(file).decode().splitlines(True),data.decode().splitlines(True),fromfile=file+' live',tofile=file+' candidate')))
 (folder/'review.diff').write_text(''.join(diffs));(folder/'function-patches.json').write_text(json.dumps(patches,indent=2))
 candidate=folder/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for file,data in changes.items():
   if file not in z.namelist():out.writestr(file,data)
 with zipfile.ZipFile(candidate) as out:assert all(z.read(k)==out.read(k) for k in z.namelist() if k not in changes)
 manifest.append({'name':name,'beforeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidateSha256':sha(candidate.read_bytes()),'candidate':str(candidate),'changedFiles':list(changes),'functionPatches':{k:v['functions'] for k,v in patches.items()},'otherEntriesPreserved':True,'configurationChanged':False,'role':c['Role']})
 print(name, 'reviewed targets',len(changes),'wrapper files',len(patches),'direct diff lines',sum(len(x.splitlines()) for x in diffs),flush=True)
(O/'manifest.private.json').write_text(json.dumps(manifest,indent=2));os.chmod(O/'manifest.private.json',0o600)
print('Prepared only; no services or financial records changed.')
