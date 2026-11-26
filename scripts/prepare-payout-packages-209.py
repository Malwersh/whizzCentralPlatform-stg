"""Build small overlays over exact live packages; preserve every other ZIP entry."""
import pathlib,json,zipfile,hashlib,base64,copy,subprocess
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/payout-209');out=p/'packages';out.mkdir(exist_ok=True)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
# Bundle the newly used SSM client so runtime SDK inventory is not an assumption.
otp=out/'payout-otp-provider.js'
subprocess.run(['node','-e',"require('./backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:['backend/staff-service/payout-otp-provider.js'],bundle:true,platform:'node',target:'node20',outfile:process.argv[1],logLevel:'warning'})",str(otp)],cwd=root,check=True)
maps={
 'staging-wizz-staff-service':{n:root/'backend/staff-service'/n for n in ['settlement-runtime.js','settlement-schedules.js','settlement-orders.js','settlement-evidence-fields.json','finance-rollout.js','merchant-payouts.js','commercial-owner.js','package.json','package-lock.json']},
 'order-receiver-regional-staging-unified-auth-v4-sam':{'settlement_schedules.js':root/'../whizzMerchants-stg/backend/functions/auth/settlement_schedules.js'},
 'staging-wizz-wallet-service':{'dist/ledgerEffects.js':root/'backend/wallet-service/dist/ledgerEffects.js'},
 'staging-wizz-wallet-lifecycle':{'dist/ledgerEffects.js':root/'backend/wallet-service/dist/ledgerEffects.js'},
 'staging-account-deletion-worker':{n:root/'backend/account-deletion'/n for n in ['cod-retention.js','settlement-retention.js','payout-retention.js']},
 'staging-account-deletion-requests':{'cod-retention.js':root/'backend/account-deletion/cod-retention.js'},
 'staging-account-deletion-financial-expiry':{'cod-retention.js':root/'backend/account-deletion/cod-retention.js'}
}
maps['staging-wizz-staff-service']['payout-otp-provider.js']=otp
rows=[]
for name,changes in maps.items():
 old=json.loads((p/'live'/(name+'.config.private.json')).read_text());base=p/'live'/(name+'.zip');assert sha(base.read_bytes())==old['CodeSha256']
 folder=out/name;folder.mkdir(exist_ok=True);payload={k:v.read_bytes() for k,v in changes.items()}
 for k,b in payload.items():
  dest=folder/k;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(b)
  if k.endswith('.js'):subprocess.run(['node','--check',str(dest)],check=True,capture_output=True)
 candidate=out/(name+'.zip')
 with zipfile.ZipFile(base) as before:
  payload={k:b for k,b in payload.items() if k not in before.namelist() or before.read(k)!=b}
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as after:
   for entry in before.infolist():after.writestr(copy.copy(entry),payload.get(entry.filename,before.read(entry.filename)))
   for k,b in payload.items():
    if k not in before.namelist():after.writestr(k,b)
  with zipfile.ZipFile(candidate) as after:
   assert all(before.read(k)==after.read(k) for k in before.namelist() if k not in payload)
   assert all(after.read(k)==b for k,b in payload.items())
 rows.append({'name':name,'candidate':str(candidate),'baseCodeSha256':old['CodeSha256'],'baseRevisionId':old['RevisionId'],'codeSha256':sha(candidate.read_bytes()),'changedFiles':list(payload),'otherEntriesIdentical':True})
(p/'packages.json').write_text(json.dumps({'part':209,'status':'PREPARED_NOT_PUBLISHED','functions':rows},indent=2)+'\n');print(json.dumps([{'name':r['name'],'changedFiles':len(r['changedFiles'])} for r in rows]))
