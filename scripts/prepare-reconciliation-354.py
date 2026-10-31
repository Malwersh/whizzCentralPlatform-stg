"""Prepare read-only reconciliation corrections and scoped read policies."""
from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,copy,hashlib,base64
R=Path(__file__).resolve().parents[1];O=R/'backend/.tmp/reconciliation-354';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)+['--output','json']))
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
subprocess.run([str(R/'backend/wallet-service/node_modules/.bin/esbuild'),str(R/'backend/wallet-service/src/reconciliation.ts'),'--bundle','--platform=node','--target=node20','--keep-names','--external:@aws-sdk/*','--outfile='+str(O/'reconciliation.js')],check=True)
manifest=[]
for name in ['staging-wizz-wallet-service','staging-wizz-staff-service']:
 f=aws('lambda','get-function','--function-name',name);c=f['Configuration'];raw=urllib.request.urlopen(f['Code']['Location'],timeout=55).read();assert sha(raw)==c['CodeSha256'];z=zipfile.ZipFile(io.BytesIO(raw));(O/(name+'-before.zip')).write_bytes(raw);(O/(name+'-config.private.json')).write_text(json.dumps(c));
 if name=='staging-wizz-wallet-service':changes={'dist/reconciliation.js':(O/'reconciliation.js').read_bytes()};assert b'function reconciliationReport' in z.read('dist/reconciliation.js')
 else:
  source=(R/'backend/staff-service/company-accounts.js').read_bytes();assert z.read('company-accounts.js')==source.replace(b"'debtIqd','creditIqd','creditPaidIqd'",b"'debtIqd','creditPaidIqd'"),'STAFF_SOURCE_DRIFT';changes={'company-accounts.js':source}
 candidate=O/(name+'-candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
 with zipfile.ZipFile(candidate) as out:assert all(z.read(k)==out.read(k) for k in z.namelist() if k not in changes)
 manifest.append({'name':name,'beforeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'candidateSha256':sha(candidate.read_bytes()),'candidate':str(candidate),'changedFiles':list(changes),'role':c['Role']});print('Prepared',name,list(changes),flush=True)
(O/'manifest.private.json').write_text(json.dumps(manifest,indent=2))
fields=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./backend/staff-service/company-accounts').fields))"],cwd=R))
policy=json.loads((R/'docs/company-accounts-read-policy-281.json').read_text());policy['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes']=fields
walletPolicy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':'dynamodb:GetItem','Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform','Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DRIVER_PAYOUT#*']},'ForAllValues:StringEquals':{'dynamodb:Attributes':['pk','sk','kind','driverId','payoutId','status','amount']},'Null':{'dynamodb:Attributes':'false','dynamodb:LeadingKeys':'false'}}}]}
(O/'staff-read-policy.json').write_text(json.dumps(policy,indent=2));(O/'wallet-read-policy.json').write_text(json.dumps(walletPolicy,indent=2));proof=[]
for label,p,resource,action,attrs,leading in [('staff',policy,policy['Statement'][0]['Resource'][0],'dynamodb:Scan',fields,None),('wallet',walletPolicy,walletPolicy['Statement'][0]['Resource'],'dynamodb:GetItem',['pk','sk','kind','driverId','payoutId','status','amount'],'DRIVER_PAYOUT#id')]:
 for extra,decision in [([], 'allowed'),(['passwordHash'],'implicitDeny')]:
  ctx=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs+extra},{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']}]
  if leading:ctx.append({'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[leading]})
  v=aws('iam','simulate-custom-policy','--policy-input-list',json.dumps(p),'--action-names',action,'--resource-arns',resource,'--context-entries',json.dumps(ctx))['EvaluationResults'][0];assert v['EvalDecision']==decision;proof.append({'role':label,'secretAttributeIncluded':bool(extra),'decision':decision})
(O/'permission-proof.json').write_text(json.dumps(proof,indent=2));print('PASS projected read permission simulation')
