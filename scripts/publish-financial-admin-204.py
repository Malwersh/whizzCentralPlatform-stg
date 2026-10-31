"""Publish the prepared bounded Staging admin repair; never writes financial records."""
import boto3,json,pathlib,time,hashlib,base64
p=pathlib.Path('/private/tmp/financial-admin-204');m=json.loads((p/'manifest.json').read_text());assert not m['apiDrift'],m['apiDrift']
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');i=s.client('iam');a=s.client('apigateway');name=m['function']
c=l.get_function_configuration(FunctionName=name);assert c['CodeSha256']==m['baseSha'] and c['RevisionId']==m['revisionId'],'LAMBDA_DRIFT'
for x in m['apiAuthFixes']:
 cur=a.get_method(restApiId='z14s5f8oxh',resourceId=x['resourceId'],httpMethod=x['method']);assert cur['authorizationType']==x['from'],'API_AUTH_DRIFT'
# Read-only permissions solely for branch order discovery and accepted-offer evidence.
i.put_role_policy(RoleName=m['role'],PolicyName='CompletedOrderStatements204',PolicyDocument=json.dumps(m['newReadOnlyPolicy']))
r=l.update_function_code(FunctionName=name,ZipFile=(p/'staff.candidate.zip').read_bytes(),RevisionId=c['RevisionId'])
for _ in range(45):
 c=l.get_function_configuration(FunctionName=name)
 if c.get('LastUpdateStatus')!='InProgress':break
 time.sleep(2)
assert c['LastUpdateStatus']=='Successful';assert c['CodeSha256']==base64.b64encode(hashlib.sha256((p/'staff.candidate.zip').read_bytes()).digest()).decode()
for x in m['apiAuthFixes']:
 if x['from']=='CUSTOM':continue
 a.update_method(restApiId='z14s5f8oxh',resourceId=x['resourceId'],httpMethod=x['method'],patchOperations=[{'op':'replace','path':'/authorizationType','value':'CUSTOM'},{'op':'replace','path':'/authorizerId','value':'2bqq12'}])
stage=a.get_stage(restApiId='z14s5f8oxh',stageName='staging');(p/'api-stage-before.private.json').write_text(json.dumps(stage,default=str));dep=a.create_deployment(restApiId='z14s5f8oxh',stageName='staging',description='204: bind lifecycle routes to existing wallet authorizer')
receipt={'part':204,'status':'PUBLISHED','function':name,'codeSha256':c['CodeSha256'],'entries':m['changedEntries'],'apiDeploymentId':dep['id'],'apiAuthFixes':m['apiAuthFixes'],'readOnlyPolicy':m['newReadOnlyPolicy'],'financialDataWrites':False,'userRolesChanged':False,'sameAdministratorApproval':'Designated DIRECT operators; immutable proposal policy and owner consent required'}
pathlib.Path('docs/financial-admin-repair-204.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt,indent=2))
