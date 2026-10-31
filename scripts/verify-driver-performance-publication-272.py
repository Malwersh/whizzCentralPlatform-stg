from pathlib import Path
import json,subprocess,urllib.request,zipfile,io,hashlib,base64
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-performance-272')
def aws(*a):return json.loads(subprocess.check_output(['aws','--profile','Wizz_stg_UserApp','--region','us-east-1',*a,'--output','json']))
report=json.loads((R/'docs/driver-performance-publication-272.json').read_text());assert report['status']=='PUBLISHED_STAGING'
checks=[]
for i in json.loads((R/'docs/driver-performance-packages-272.json').read_text())['functions']:
 f=aws('lambda','get-function','--function-name',i['function'])
 with urllib.request.urlopen(f['Code']['Location'],timeout=120)as r:b=r.read()
 assert base64.b64encode(hashlib.sha256(b).digest()).decode()==i['candidate']
 actual=zipfile.ZipFile(io.BytesIO(b));candidate=zipfile.ZipFile(P/(i['label']+'-candidate.zip'))
 assert actual.namelist()==candidate.namelist() and all(actual.read(n)==candidate.read(n)for n in actual.namelist())
 checks.append(i['function']+': downloaded deployment identical to tested candidate')
role=json.loads((P/'driver-config.private.json').read_text())['Role']
policy=aws('iam','get-role-policy','--role-name',role.split('/')[-1],'--policy-name','DriverOfferDisplayReceipt272')['PolicyDocument']
assert policy==json.loads((R/'docs/driver-offer-receipt-policy-272.json').read_text())
sim=aws('iam','simulate-principal-policy','--policy-source-arn',role,'--action-names','dynamodb:Query','dynamodb:PutItem','dynamodb:ConditionCheckItem','--resource-arns','arn:aws:dynamodb:us-east-1:699561669180:table/WaveOffers_staging')
assert all(x['EvalDecision']=='allowed'for x in sim['EvaluationResults']);checks.append('Receipt role policy exact and all three actions allowed')
web=zipfile.ZipFile(P/'web-candidate.zip')
for n in json.loads((P/'web-changes.json').read_text()):
 with urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+n+'?verify=272',timeout=60)as r:b=r.read()
 assert b==web.read(n),n
 checks.append('Hosted bytes verified: '+n)
report['verification']={'status':'PASS','checks':checks,'businessWritesByAgent':0}
(R/'docs/driver-performance-publication-272.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report['verification'],indent=2))
