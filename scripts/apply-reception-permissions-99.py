"""Requires explicit user approval after automatic review rejection. Do not run before approval."""
from pathlib import Path
import json,importlib.util
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);iam=m.session().client('iam');policies=json.loads((O/'permissions99.private.json').read_text());results=[]
for role,policy in policies.items():
 try:iam.get_role(RoleName=role)
 except iam.exceptions.NoSuchEntityException:
  assert role=='staging-merchant-response-99'
  iam.create_role(RoleName=role,AssumeRolePolicyDocument=json.dumps({'Version':'2012-10-17','Statement':[{'Effect':'Allow','Principal':{'Service':'lambda.amazonaws.com'},'Action':'sts:AssumeRole'}]}),Description='Staging merchant response deadlines and pause resume; platform funding only')
 try:old=iam.get_role_policy(RoleName=role,PolicyName='MerchantReception99')['PolicyDocument']
 except iam.exceptions.NoSuchEntityException:old=None
 p=O/(role+'.policy-before99.private.json');p.write_text(json.dumps(old));p.chmod(0o600)
 if old is not None:assert old==policy,'REVIEW_PERMISSION_DRIFT'
 else:iam.put_role_policy(RoleName=role,PolicyName='MerchantReception99',PolicyDocument=json.dumps(policy))
 results.append({'role':role,'policy':'MerchantReception99'})
(O/'permissions99-applied.json').write_text(json.dumps(results,indent=2));print(json.dumps({'rolesConfigured':len(results),'driverOrMerchantWalletGrants':False,'existingPoliciesPreserved':True}))
