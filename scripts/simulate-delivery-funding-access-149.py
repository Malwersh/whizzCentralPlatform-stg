"""Read-only IAM simulations using captured staging Lambda execution roles."""
import concurrent.futures,importlib.util,json,os,pathlib,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path(sys.argv[1]);assert OUT.is_absolute()
FUNCTIONS={'WizzUser-CreateOrder-staging':'CUSTOMER','staging-driver-financial-accept':'FINANCIAL','staging-merchant-response-99':'PENDING','order-receiver-merchant-orders-staging-v1':'PENDING','staging-wizz-staff-service':'STAFF'}
S='arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff';P='arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform'
cases=[]
for name,kind in FUNCTIONS.items():
 row=json.loads((OUT/(name+'.summary.private.json')).read_text());role=row['role'];assert role.startswith('arn:aws:iam::699561669180:role/')
 prefixes=['DELIVERY_BUDGET#review','DELIVERY_USAGE#review','DELIVERY_RESERVATION#review']
 checks=[(action,S,key) for key in prefixes for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:PutItem']]
 if kind=='CUSTOMER':checks += [(action,S,key) for key in ['DELIVERY_FUNDING#review','EMPLOYEE#review','OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS'] for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem']]+[('dynamodb:Query',P,'BRANCH#review')]+[(action,P,key) for key in ['BRANCH#review','PERSON#review'] for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem']]
 if kind=='STAFF':checks=[(action,S,key) for key in ['DELIVERY_FUNDING#review','DELIVERY_BUDGET#review'] for action in ['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:PutItem']]
 for action,resource,leading in checks:cases.append({'function':name,'role':role,'action':action,'resource':resource,'leadingKey':leading})
def simulate(case):
 req={'PolicySourceArn':case['role'],'ActionNames':[case['action']],'ResourceArns':[case['resource']],'ContextEntries':[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[case['leadingKey']]}]}
 p=subprocess.run(['aws','iam','simulate-principal-policy','--cli-input-json',json.dumps(req),'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','20'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=30)
 if p.returncode:return {**case,'error':'ACCESS_DENIED' if 'AccessDenied' in p.stderr else 'THROTTLED' if 'Throttl' in p.stderr else 'SIMULATION_FAILED'}
 result=json.loads(p.stdout)['EvaluationResults'][0]
 return {**case,'decision':result['EvalDecision'],'missingContext':result.get('MissingContextValues',[]),'permissionsBoundary':result.get('PermissionsBoundaryDecisionDetail')}
previous=OUT/'simulations.private.json'
cached=json.loads(previous.read_text())['results'] if previous.exists() else []
rows=[]
for case in cases:
 prior=next((r for r in cached if all(r.get(k)==case[k] for k in ['function','role','action','resource','leadingKey']) and 'decision' in r),None)
 if prior:rows.append(prior);continue
 for attempt in range(4):
  row=simulate(case)
  if row.get('error')!='THROTTLED':break
  time.sleep(min(4,attempt+1))
 rows.append(row);time.sleep(0.6)
report={'part':149,'readOnly':True,'applied':False,'scope':'principal-policy simulation only; not an end-to-end service authorization proof','context':'synthetic campaign identifiers, captured actual execution role, existing staging table ARN','results':rows}
p=OUT/'simulations.private.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
print(json.dumps({'simulations':len(rows),'allowed':sum(r.get('decision')=='allowed' for r in rows),'denied':sum(r.get('decision') in ['implicitDeny','explicitDeny'] for r in rows),'errors':sum('error' in r for r in rows),'applied':False}))
