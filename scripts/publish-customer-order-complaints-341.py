"""C05 staging deployment. Run only after explicit approval for manifest scope."""
from pathlib import Path
import base64,datetime,hashlib,json,subprocess,os
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/customer-complaints-341');B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];ACCOUNT='699561669180'
def aws(*args):
 raw=subprocess.check_output(B+list(args)+['--output','json'])
 return json.loads(raw) if raw.strip() else {}
if os.environ.get('C05_STAGING_PUBLISH_APPROVED')!='YES':raise SystemExit('Explicit user approval required before staging publication')
review=json.loads((P/'package-review.json').read_text());assert review['financialExecutorsPreserved']and review['supportServiceUnchanged']
for r in review['functions']:
 current=aws('lambda','get-function-configuration','--function-name',r['name']);assert current['CodeSha256']==r['beforeCodeSha256']and current['RevisionId']==r['revisionId'],'DEPLOYED_DRIFT '+r['tag'];assert hashlib.sha256((P/(r['tag']+'-candidate.zip')).read_bytes()).hexdigest()==r['candidateSHA256']
role='staging-cod-lifecycle-DriverFinancialAcceptanceFunc-ByuiNV8TkCUW'
policy=json.loads((R/'docs/customer-order-complaints-iam-341.json').read_text())
file=P/'complaint-policy.json';file.write_text(json.dumps(policy));aws('iam','put-role-policy','--role-name',role,'--policy-name','CustomerOrderComplaints341','--policy-document','file://'+str(file));print('Applied scoped support proof access; no new money permissions',flush=True)
receipt={'part':341,'scope':'staging','functions':[],'newFinancialPermissions':False,'supportServiceUnchanged':True,'businessWritesByAgent':0};receiptPath=R/'docs/customer-order-complaints-publication-341.json'
for tag in ['deletion','deletionworker','financial','staff','order']:
 r=next(x for x in review['functions']if x['tag']==tag);before=aws('lambda','get-function-configuration','--function-name',r['name']);assert before['CodeSha256']==r['beforeCodeSha256']and before['RevisionId']==r['revisionId'],'DEPLOYED_DRIFT '+tag
 path=P/(tag+'-candidate.zip');aws('lambda','update-function-code','--function-name',r['name'],'--revision-id',r['revisionId'],'--zip-file','fileb://'+str(path));subprocess.check_call(B+['lambda','wait','function-updated-v2','--function-name',r['name']]);after=aws('lambda','get-function-configuration','--function-name',r['name']);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(path.read_bytes()).digest()).decode();assert after.get('Environment')==before.get('Environment')
 receipt['functions'].append({k:r[k]for k in ['tag','name','beforeCodeSha256','changedFiles','otherEntriesPreserved','configurationPreserved']}|{'publishedCodeSha256':after['CodeSha256'],'lastModified':after['LastModified']});receipt['status']='BACKEND_PARTIALLY_PUBLISHED'if len(receipt['functions'])<5 else'BACKEND_PUBLISHED_VERIFIED';receipt['publishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();receiptPath.write_text(json.dumps(receipt,indent=2)+'\n');print('Verified '+tag,flush=True)
