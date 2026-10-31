"""Prepare the direct-save simulator repair and validate quote-cleanup dependencies; no application writes."""
import pathlib,json,importlib.util,zipfile,copy,urllib.request,hashlib,base64,difflib,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance67');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 s=m.session();lam=s.client('lambda');iam=s.client('iam');rows={}
 for key,name in [('staff','staging-wizz-staff-service'),('cleanup','staging-account-deletion-worker')]:
  f=lam.get_function(FunctionName=name);cfg=f['Configuration'];data=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();assert sha(data)==cfg['CodeSha256'];(O/(key+'.zip')).write_bytes(data);(O/(key+'.config.private.json')).write_text(json.dumps(cfg));rows[key]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId']}
 with zipfile.ZipFile(O/'cleanup.zip') as z:
  assert z.read('customer-delivery-quotes.js')==(R/'backend/account-deletion/customer-delivery-quotes.js').read_bytes(),'CLEANUP_IMPLEMENTATION_DRIFT'
  entry=rows['cleanup']['name'];cfg=json.loads((O/'cleanup.config.private.json').read_text());handler=cfg['Handler'].rsplit('.',1)[0]+'.js';body=z.read(handler).decode();assert "deliveryQuotesEnabled:process.env.DELIVERY_QUOTES_ENABLED==='true'" in body
 with zipfile.ZipFile(O/'staff.zip') as z:
  candidate=(R/'backend/staff-service/delivery-pricing.js').read_bytes();old=z.read('delivery-pricing.js');diff=list(difflib.unified_diff(old.decode().splitlines(),candidate.decode().splitlines(),'live','candidate',n=2));assert len(diff)<40,'UNEXPECTED_PRICING_DRIFT';assert b"const savedDraftValues=structuredClone(nextValues)" in candidate;(O/'pricing.diff').write_text('\n'.join(diff))
  with zipfile.ZipFile(O/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),candidate if info.filename=='delivery-pricing.js' else z.read(info.filename))
  with zipfile.ZipFile(O/'staff.candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n!='delivery-pricing.js')
 checks=[]
 for action in ['dynamodb:Query','dynamodb:DeleteItem']:
  decision=iam.simulate_principal_policy(PolicySourceArn=cfg['Role'],ActionNames=[action],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/staging-DeliveryQuotes'],ContextEntries=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['CUSTOMER#readiness67']}])['EvaluationResults'][0]['EvalDecision'];checks.append({'action':action,'decision':decision})
 (O/'cleanup-iam-before.json').write_text(json.dumps(checks,indent=2))
 scopeSummary=[]
 for name in ['WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging','staging-driver-financial-accept']:
  c=lam.get_function_configuration(FunctionName=name);env=c.get('Environment',{}).get('Variables',{});raw=env.get('FINANCE_ROLLOUT_CONFIG');v=json.loads(raw) if raw else {};scopes=v.get('scopes',[]);scopeSummary.append({'name':name,'scopeDigest':env.get('FINANCE_ROLLOUT_SHA256'),'scopeCount':len(scopes),'scopeAdmissionOpenCount':sum(x.get('mode')=='SCOPED' and x.get('admitUntil','')>datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z') for x in scopes),'fattooshIncluded':any(o.get('branchId')=='business_95ac73c9-feda-4207-9285-550aec61b94c' for x in scopes for o in x.get('orders',[]))})
 p={'part':67,'environment':'Staging','base':rows,'staffCandidateCodeSha256':sha((O/'staff.candidate.zip').read_bytes()),'changedLambdaFiles':['delivery-pricing.js'],'sourceSha256':hashlib.sha256(candidate).hexdigest(),'cleanupIam':checks,'cleanupIamReady':all(x['decision']=='allowed' for x in checks),'cohortSummary':scopeSummary,'financialActivationPerformed':False,'applicationWrites':False};(O/'preparation.json').write_text(json.dumps(p,indent=2));print(json.dumps({'prepared':True,'cleanupIamAllowed':sum(x['decision']=='allowed' for x in checks),'sampleCohortConfigured':all(x['fattooshIncluded'] for x in scopeSummary),'lambdaFilesChanged':1,'financialActivation':False}))
if __name__=='__main__':main()
