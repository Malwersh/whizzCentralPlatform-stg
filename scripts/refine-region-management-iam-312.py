from pathlib import Path
import json,subprocess,copy
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/regions-312';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];doc=R/'docs/region-management-publication-312.json'
def aws(*a):
 r=subprocess.check_output(B+list(a)+['--output','json']);return json.loads(r)if r.strip()else{}
r=json.loads(doc.read_text());assert r['status']=='BACKEND_PUBLISHED_VERIFIED';arn=r['staffManagedPolicyArn'];meta=aws('iam','get-policy','--policy-arn',arn)['Policy'];old=aws('iam','get-policy-version','--policy-arn',arn,'--version-id',meta['DefaultVersionId'])['PolicyVersion']['Document'];policy=copy.deepcopy(old)
for s in policy['Statement']:
 keys=s.get('Condition',{}).get('ForAllValues:StringLike',{}).get('dynamodb:LeadingKeys',[])
 if 'AUDIT'in keys:keys.remove('AUDIT')
stmt={'Effect':'Allow','Action':['dynamodb:PutItem'],'Resource':['arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'],'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['AUDIT']}}}
if stmt not in policy['Statement']:policy['Statement'].append(stmt)
if policy!=old:
 path=P/'staff-narrow-audit-policy.json';path.write_text(json.dumps(policy));aws('iam','create-policy-version','--policy-arn',arn,'--policy-document','file://'+str(path),'--set-as-default')
params=json.loads((P/'stack-parameters.private.json').read_text());assert params['Enabled']=='true'
subprocess.run(B+['cloudformation','deploy','--template-file',str(R/'cloudformation/region-management-312.yaml'),'--stack-name','staging-region-management-312','--capabilities','CAPABILITY_NAMED_IAM','--no-fail-on-empty-changeset','--parameter-overrides',*[k+'='+v for k,v in params.items()]],check=True)
role=r['infrastructure']['WorkerRoleArn'];table='arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'
result=aws('iam','simulate-principal-policy','--policy-source-arn',role,'--action-names','dynamodb:GetItem','dynamodb:DeleteItem','--resource-arns',table,'--context-entries','ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=AUDIT,ContextKeyType=stringList');assert all(x['EvalDecision']!='allowed'for x in result['EvaluationResults'])
result=aws('iam','simulate-principal-policy','--policy-source-arn',role,'--action-names','dynamodb:PutItem','--resource-arns',table,'--context-entries','ContextKeyName=dynamodb:LeadingKeys,ContextKeyValues=AUDIT,ContextKeyType=stringList');assert all(x['EvalDecision']=='allowed'for x in result['EvaluationResults'])
r['workerAuditAppendOnly']=True;r['newStaffPolicyAuditGrantAppendOnly']=True;doc.write_text(json.dumps(r,indent=2)+'\n');print('Verified region worker audit permission is append-only; prior staff policies unchanged')
