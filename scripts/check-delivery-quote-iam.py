# Read-only IAM simulation of the generated additions, not the full existing role policies.
import subprocess,json,pathlib,sys
if len(sys.argv)!=2:raise SystemExit('EXPECTED_PREPARED_RELEASE_DIRECTORY')
base=pathlib.Path(sys.argv[1])
manifest=json.loads((base/'manifest.json').read_text())
if manifest.get('accountId')!='699561669180' or manifest.get('region')!='us-east-1' or manifest.get('activationReady') is not False:raise SystemExit('STAGING_PREPARATION_REQUIRED')
identity=subprocess.run(['aws','sts','get-caller-identity','--profile','Wizz_stg_UserApp','--output','json'],capture_output=True,text=True,check=True)
if json.loads(identity.stdout)['Account']!='699561669180':raise SystemExit('STAGING_ACCOUNT_REQUIRED')
arn=lambda table:'arn:aws:dynamodb:us-east-1:699561669180:table/'+table
quote=arn('staging-DeliveryQuotes');users=arn('WizzUser_users_staging');policy=arn('staging-PlatformStaff')
def simulate(label,filename,actions,resources,key,allowed):
 context=[{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyValues':[key],'ContextKeyType':'stringList'}]
 cmd=['aws','iam','simulate-custom-policy','--policy-input-list',json.dumps([json.dumps(json.loads((base/filename).read_text()))]),'--action-names',*actions,'--resource-arns',*resources,'--context-entries',json.dumps(context),'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json']
 p=subprocess.run(cmd,capture_output=True,text=True)
 if p.returncode:raise RuntimeError('IAM_SIMULATION_FAILED '+label)
 evaluations=json.loads(p.stdout)['EvaluationResults'];summary=[]
 result=[]
 for entry in evaluations:
  specifics=entry.get('ResourceSpecificResults',[])
  if specifics:
   result.extend({'EvalActionName':entry['EvalActionName'],'EvalResourceName':v['EvalResourceName'],'EvalDecision':v['EvalResourceDecision']} for v in specifics)
  else:result.append(entry)
 for r in result:
  action,resource=r['EvalActionName'],r['EvalResourceName']
  ok=r['EvalDecision']=='allowed';expected=(action,resource) in allowed
  if ok!=expected:raise RuntimeError('IAM_EXPECTATION_FAILED '+label+' '+action+' '+resource)
  summary.append({'action':action,'resource':resource,'decision':r['EvalDecision']})
 if len(summary)!=len(actions)*len(resources):raise RuntimeError('INCOMPLETE_IAM_MATRIX '+label)
 return {'case':label,'results':summary}
a=['dynamodb:'+s for s in ['GetItem','UpdateItem','PutItem','DeleteItem','ConditionCheckItem']]
checks=[]
checks.append(simulate('order-customer','order-iam-additions.json',a,[quote,users,policy,arn('staging-LedgerEntries')],'CUSTOMER#synthetic',set((x,quote) for x in [a[0],a[1],a[4]])|set((x,users) for x in [a[0],a[4]])))
checks.append(simulate('order-policy','order-iam-additions.json',['dynamodb:GetItem','dynamodb:ConditionCheckItem'],[policy],'OPERATIONAL_SETTINGS#DELIVERY_PRICING',{('dynamodb:ConditionCheckItem',policy)}))
checks.append(simulate('order-foreign-partition','order-iam-additions.json',a,[quote],'PERSON#synthetic',set()))
b=['dynamodb:'+s for s in ['Query','DeleteItem','PutItem','UpdateItem','Scan']]
checks.append(simulate('cleanup-customer','cleanup-iam-additions.json',b,[quote,arn('WizzOrders'),arn('staging-LedgerEntries')],'CUSTOMER#synthetic',{(b[0],quote),(b[1],quote)}))
checks.append(simulate('cleanup-foreign-partition','cleanup-iam-additions.json',b,[quote],'BRANCH#synthetic',set()))
checks.append(simulate('quote-customer','quote-iam-without-secret.json',a,[quote,users,arn('staging-Wallets'),arn('staging-LedgerEntries')],'CUSTOMER#synthetic',{(x,quote) for x in [a[0],a[2],a[4]]}|{(x,users) for x in [a[0],a[4]]}))
report={'accountId':'699561669180','region':'us-east-1','cloudWrites':False,'scope':'CANDIDATE_ADDITIONS_ONLY_NOT_EXISTING_ROLE_EFFECTIVE_POLICY','cases':checks}
(base/'iam-simulation.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'cases':len(checks),'assertions':sum(len(c['results']) for c in checks),'allExpected':True,'cloudWrites':False}))
