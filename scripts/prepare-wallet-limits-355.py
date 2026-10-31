"""Prepare minimal wallet modules and one existing driver factory overlay."""
from pathlib import Path
import json,subprocess,zipfile,io,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/wallet-limits-355';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(v):return base64.b64encode(hashlib.sha256(v).digest()).decode()
# Ensure the four replaced wallet modules had no live patches beyond HEAD.
script="const fs=require('fs'),cp=require('child_process'),ts=require(process.argv[1]);let c=ts.readConfigFile('backend/wallet-service/tsconfig.json',ts.sys.readFile).config;c=ts.convertCompilerOptionsFromJson(c.compilerOptions,process.cwd()).options;for(const n of ['fundingService','topupService','transferSettings','index']){const s=cp.execFileSync('git',['show','HEAD:backend/wallet-service/src/'+n+'.ts'],{encoding:'utf8'});const v=ts.transpileModule(s,{compilerOptions:c,fileName:n+'.ts'}).outputText;const live=fs.readFileSync('backend/.tmp/wallet-limits-355/dist-'+n+'.js','utf8');if(v.trim()!==live.trim())throw Error('UNREVIEWED_MODULE_DRIFT '+n);}"
subprocess.run(['node','-e',script,str(R/'backend/wallet-service/node_modules/typescript')],cwd=R,check=True)
entry=O/'entry.ts';entry.write_text('export {createDriverCashPayout} from "'+str(R/'backend/wallet-service/src/driverCashPayout')+'";')
subprocess.run([str(R/'backend/wallet-service/node_modules/.bin/esbuild'),str(entry),'--bundle','--platform=node','--target=node20','--keep-names','--external:@aws-sdk/*','--outfile='+str(O/'driver-wallet-limits-355.js')],check=True)
manifest=[]
for name in ['staging-wizz-wallet-service','staging-driver-financial-accept']:
 c=json.loads((O/(name+'-config.private.json')).read_text());current=aws('lambda','get-function-configuration','--function-name',name);assert current['CodeSha256']==c['CodeSha256'] and current['RevisionId']==c['RevisionId'],'LIVE_DRIFT '+name
 raw=(O/(name+'-before.zip')).read_bytes();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));changes={}
 if name=='staging-wizz-wallet-service':
  for module in ['index','fundingService','topupService','transferSettings','walletOperatingLimits','walletLimitsSettings']:
   for ext in ['.js','.js.map']:changes['dist/'+module+ext]=(R/'backend/wallet-service/dist'/(module+ext)).read_bytes()
 else:
  changes['driver-wallet-limits-355.js']=(O/'driver-wallet-limits-355.js').read_bytes();source=O/'driver-runtime-before.js';dest=O/'driver-runtime-after.js';report=O/'driver-overlay.json';subprocess.run(['node',str(R/'scripts/patch-driver-wallet-limits-355.cjs'),str(source),str(dest),str(report)],check=True);changes['driver-cash-payout-runtime-v1.js']=dest.read_bytes()
 candidate=O/(name+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for f,data in changes.items():
   if f not in z.namelist():out.writestr(f,data)
 with zipfile.ZipFile(candidate) as out:assert all(z.read(f)==out.read(f) for f in z.namelist() if f not in changes)
 manifest.append({'name':name,'role':c['Role'],'beforeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidateSha256':sha(candidate.read_bytes()),'candidate':str(candidate),'changedFiles':list(changes),'otherEntriesPreserved':True});print('Prepared',name,len(changes),'files',flush=True)
(O/'manifest.private.json').write_text(json.dumps(manifest,indent=2));print('Prepared only; no settings or balances changed')
