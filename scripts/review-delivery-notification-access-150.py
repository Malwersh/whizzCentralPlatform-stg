"""Prepare and simulate projected delivery-notice read permission. Never applies it."""
import ast,hashlib,json,os,pathlib,re,subprocess,sys,time
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path(sys.argv[1]);inv=json.loads((O/'extra-inventory.private.json').read_text());role=inv['notification']['Role'];table='arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'
fields=ast.literal_eval(re.search(r'const fields=(\[.*?\]);',(R/'backend/src/utils/commercial-sharing-push.js').read_text(),re.S).group(1));assert not set(fields)&{'values','policy','funding','walletId','amount'}
policy={'Version':'2012-10-17','Statement':[{'Sid':'DeliveryNoticeMetadata150','Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':table,'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['DELIVERY_FUNDING#*']},'ForAllValues:StringEquals':{'dynamodb:Attributes':fields},'Null':{'dynamodb:LeadingKeys':'false','dynamodb:Attributes':'false'}}}]}
def aws(*args):
 p=subprocess.run(['aws',*args,'--profile','Wizz_stg_UserApp','--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','8','--cli-read-timeout','25'],capture_output=True,text=True,env={**os.environ,'AWS_MAX_ATTEMPTS':'2'},timeout=60)
 if p.returncode:raise RuntimeError('NOTIFICATION_READ_OR_SIMULATION_FAILED')
 return json.loads(p.stdout)
results=[]
for label,added,attrs in [('baseline',False,fields),('candidate',True,fields),('excluded_financial_fields',True,fields+['values','policy'])]:
 req={'PolicySourceArn':role,'ActionNames':['dynamodb:GetItem'],'ResourceArns':[table],'ContextEntries':[{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']},{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':['DELIVERY_FUNDING#review']},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':attrs}]}
 if added:req['PolicyInputList']=[json.dumps(policy)]
 r=aws('iam','simulate-principal-policy','--cli-input-json',json.dumps(req))['EvaluationResults'][0];results.append({'case':label,'decision':r['EvalDecision'],'missingContext':r.get('MissingContextValues',[])});time.sleep(0.6)
(O/'notification-simulation.private.json').write_text(json.dumps(results,indent=2)+'\n')
assert [r['decision'] for r in results]==['implicitDeny','allowed','implicitDeny'] and not any(r['missingContext'] for r in results)
used=aws('lambda','list-functions','--query','Functions[].{name:FunctionName,role:Role}');trust=aws('iam','get-role','--role-name',role.rsplit('/',1)[-1])['Role']
report={'part':150,'reviewOnly':True,'applied':False,'roleArn':role,'policyName':'DeliveryNotice150','policy':policy,'functionsUsingRole':sorted(f['name'] for f in used if f['role']==role),'baselineRolePolicySnapshotSha256':hashlib.sha256((O/(role.rsplit('/',1)[-1]+'.policies.private.json')).read_bytes()).hexdigest(),'simulations':results,'limitation':'Shared role: additional GetItem metadata permission affects all listed notification functions; no full policy/financial fields or wallet authority.'}
p=O/'notification-permission-candidate.json';p.write_text(json.dumps(report,indent=2)+'\n');os.chmod(p,0o600)
print(json.dumps({'baseline':'implicitDeny','candidate':'allowed','financialFields':'implicitDeny','functionsUsingRole':len(report['functionsUsingRole']),'applied':False}))
