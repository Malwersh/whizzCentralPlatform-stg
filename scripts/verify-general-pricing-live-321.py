"""Read-only policy/reader verification. Never invokes an order, driver or wallet action."""
import pathlib,sys,json,urllib.request,zipfile,subprocess
from decimal import Decimal
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/general321');s=session();l=s.client('lambda');db=s.resource('dynamodb')
def plain(v):return json.loads(json.dumps(v,default=lambda x:int(x)if isinstance(x,Decimal)and x==int(x)else float(x)))
policy=plain(db.Table('staging-PlatformStaff').get_item(Key={'pk':'OPERATIONAL_SETTINGS#DELIVERY_PRICING','sk':'CURRENT'},ConsistentRead=True)['Item']);assert policy['version']==2
(p/'policy-active.json').write_text(json.dumps(policy,indent=2)+'\n')
rows=[];expected=json.loads(pathlib.Path('/private/tmp/pricing320/consumers-safe.json').read_text());published=json.loads((root/'docs/general-pricing-code-publication-321.json').read_text())
for old in expected:
 c=l.get_function_configuration(FunctionName=old['function']);assert c.get('Environment',{}).get('Variables',{}).get('FINANCE_GENERAL_RELEASE_MODE')=='REQUIRED',old['function']
 assert c['CodeSha256']==(published['codeSha256']if old['function']=='WizzUser-DeliveryQuotes-staging'else old['codeSha256']),'Reader concurrently changed: '+old['function']
 rows.append({'function':old['function'],'codeSha256':c['CodeSha256'],'generalReleaseMode':'REQUIRED'})
# Load the actual hosted staff engine, which is also the published central simulator.
r=l.get_function(FunctionName='staging-wizz-staff-service');raw=urllib.request.urlopen(r['Code']['Location'],timeout=60).read();(p/'staff-live.zip').write_bytes(raw)
out=p/'staff-live';out.mkdir(exist_ok=True)
with zipfile.ZipFile(p/'staff-live.zip')as z:
 for n in ['pricing-runtime/deliveryPricing.js','pricing-runtime/money.js']:
  f=out/n;f.parent.mkdir(parents=True,exist_ok=True);f.write_bytes(z.read(n))
subprocess.run(['node',str(root/'scripts/verify-general-pricing-host-321.cjs'),str(p)],cwd=root,check=True)
report={'part':321,'status':'PASS_READ_ONLY','policyVersion':2,'consumerCount':len(rows),'consumers':rows,'actualPublishedEngine':'staging-wizz-staff-service/pricing-runtime/deliveryPricing.js','coverageAndOverrides':json.loads((p/'host-verification.json').read_text()),'authenticationSmoke':'OPTIONS only; no authentication bypass or financial handler invocation','financialWrites':0,'humanOrderAcceptance':'Pending: do not claim a live end-to-end order from read-only and mocked tests','froujReadiness':'General tariff applies; organization and genuinely accepted/approved commercial binding still required before order creation.'}
(root/'docs/general-pricing-verification-321.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':'PASS_READ_ONLY','policyVersion':2,'consumers':len(rows),'financialWrites':0}))
