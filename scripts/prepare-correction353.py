"""Capture current staging and overlay reviewed functions only; no publication."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,base64,os
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/post-payout-353';O.mkdir(parents=True,exist_ok=True);B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(v):return base64.b64encode(hashlib.sha256(v).digest()).decode()
entry=O/'entry.ts';entry.write_text('export {createMerchantPayoutService,verifyMerchantPayoutJournal,readMerchantStatementPayment} from "'+str(R/'backend/wallet-service/src/merchantPayout')+'";\nexport {createExceptionFinancialClosure} from "'+str(R/'backend/wallet-service/src/exceptionFinancialClosure')+'";\nexport {createCancellationCompensation} from "'+str(R/'backend/wallet-service/src/cancellationCompensation')+'";')
script="require(process.argv[1]).buildSync({entryPoints:[process.argv[2]],outfile:process.argv[3],platform:'node',target:'node20',bundle:true,external:['@aws-sdk/*'],nodePaths:[process.argv[4]],keepNames:true,logLevel:'warning'})"
subprocess.run(['node','-e',script,str(R/'backend/wallet-service/node_modules/esbuild'),str(entry),str(O/'merchant-payout-corrections-353.js'),str(R/'backend/wallet-service/node_modules')],check=True)
manifest=[]
for name in ['staging-account-deletion-worker','staging-wizz-staff-service','order-receiver-regional-staging-unified-auth-v4-sam','staging-driver-financial-accept']:
 folder=O/name;folder.mkdir(exist_ok=True);f=aws('lambda','get-function','--function-name',name);c=f['Configuration'];(folder/'config.private.json').write_text(json.dumps(c));os.chmod(folder/'config.private.json',0o600)
 raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==c['CodeSha256'];(folder/'before.zip').write_bytes(raw);z=zipfile.ZipFile(io.BytesIO(raw));changes={};patches={}
 if name=='staging-account-deletion-worker':changes['payout-retention.js']=(R/'backend/account-deletion/payout-retention.js').read_bytes()
 else:
  changes['merchant-payout-corrections-353.js']=(O/'merchant-payout-corrections-353.js').read_bytes()
  if name=='staging-wizz-staff-service':
   for file in ['merchant-corrections.js','merchant-correction-cases.js','merchant-payouts.js','order-exception-cases.js']:changes[file]=(R/'backend/staff-service'/file).read_bytes()
  for file in z.namelist():
   if not file.endswith('.js') or 'node_modules/' in file:continue
   data=z.read(file)
   if not any(b'function '+n+b'(' in data for n in [b'createMerchantPayoutService',b'verifyMerchantPayoutJournal',b'readMerchantStatementPayment',b'createExceptionFinancialClosure',b'createCancellationCompensation']):continue
   src=folder/'ast-input.js';dest=folder/'ast-output.js';report=folder/'ast-report.json';src.write_bytes(data);subprocess.run(['node',str(R/'scripts/patch-correction-functions-353.cjs'),str(src),str(dest),str(report)],check=True);details=json.loads(report.read_text());changes[file]=dest.read_bytes();patches[file]=details
 if not patches:changes.pop('merchant-payout-corrections-353.js',None)
 changes={k:v for k,v in changes.items() if k not in z.namelist() or z.read(k)!=v}
 for file,data in changes.items():
  p=folder/'check'/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);subprocess.run(['node','--check',str(p)],check=True)
 candidate=folder/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for file,data in changes.items():
   if file not in z.namelist():out.writestr(file,data)
 with zipfile.ZipFile(candidate) as out:assert all(z.read(k)==out.read(k) for k in z.namelist() if k not in changes)
 manifest.append({'name':name,'beforeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidateSha256':sha(candidate.read_bytes()),'candidate':str(candidate),'changedFiles':list(changes),'functionPatches':{k:v['functions'] for k,v in patches.items()},'otherEntriesPreserved':True,'configurationChanged':False,'role':c['Role']});print(name,len(changes),'changed files',flush=True)
(O/'manifest.private.json').write_text(json.dumps(manifest,indent=2));os.chmod(O/'manifest.private.json',0o600)
