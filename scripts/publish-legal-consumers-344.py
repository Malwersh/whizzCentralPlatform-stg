"""Scoped staging legal reader and registration deployment, after owner publication."""
import pathlib,json,boto3,time,hashlib
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-legal-344');plan=json.loads((root/'docs/application-legal-dependent-deployment-344.json').read_text());manifest=json.loads((p/'consumer-manifest.json').read_text());s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');l=s.client('lambda');iam=s.client('iam');api=s.client('apigateway');db=s.resource('dynamodb').Table('staging-PlatformStaff')
proof={'part':344,'status':'DEPLOYING','ownerPublishedRoles':[],'functions':{},'moneyWrites':0,'businessProfileWrites':0,'nativeAppsInstalled':False};doc=root/'docs/application-legal-consumers-publication-344.json'
def save():doc.write_text(json.dumps(proof,indent=2)+'\n')
def wait(name):
 for _ in range(60):
  c=l.get_function_configuration(FunctionName=name)
  if c.get('LastUpdateStatus')=='Successful':return c
  assert c.get('LastUpdateStatus')!='Failed';time.sleep(1)
 raise RuntimeError('Lambda update timeout')
# Validate all three published documents with the same actual Node contract first.
import subprocess
subprocess.run(['node','-e',"const c=require('./backend/shared/customer-legal-contract-344');for(const r of require('/private/tmp/customer-legal-344/published-roles.json'))c.readPublished(r)"],cwd=root,check=True)
for audience in ['CUSTOMER','DRIVER','MERCHANT']:
 r=db.get_item(Key={'pk':'OPERATIONAL_SETTINGS#'+audience+'_LEGAL','sk':'CURRENT'},ConsistentRead=True)['Item'];assert r['status']=='PUBLISHED';proof['ownerPublishedRoles'].append({'audience':audience,'version':int(r['version']),'digest':r['digest']})
for role,item in plan['registrationConsumers'].items():
 name=item['functionName'];c=l.get_function_configuration(FunctionName=name);captured=json.loads((p/(role+'-current.private.json')).read_text());assert c['CodeSha256']==item['baseCodeSha256'] and c['RevisionId']==captured['RevisionId'],role+' concurrent change';assert c['Role']==item['roleArn']
# Save current stage export for review/rollback without modifying unrelated routes.
stage=api.get_stage(restApiId='f44z33oz55',stageName='staging');proof['baseApiDeploymentId']=stage['deploymentId'];save()
for role,item in plan['registrationConsumers'].items():
 name=item['functionName'];roleName=item['roleArn'].rsplit('/',1)[1];policyName='LegalDocuments344';existing=iam.list_role_policies(RoleName=roleName)['PolicyNames'];assert policyName not in existing,'Unexpected existing scoped policy'
 iam.put_role_policy(RoleName=roleName,PolicyName=policyName,PolicyDocument=json.dumps(item['additionalPolicy']))
 c=l.get_function_configuration(FunctionName=name);env=dict(c.get('Environment',{}).get('Variables',{}));env.update(item['environmentAdditions']);l.update_function_configuration(FunctionName=name,Environment={'Variables':env},RevisionId=c['RevisionId']);c=wait(name)
 assert c['Environment']['Variables']==env and c['CodeSha256']==item['baseCodeSha256'];l.update_function_code(FunctionName=name,ZipFile=(p/(role+'-legal-344.zip')).read_bytes(),RevisionId=c['RevisionId']);c=wait(name);assert c['CodeSha256']==manifest[role]['candidateCodeSha256'];assert c['Environment']['Variables']==env
 proof['functions'][role]={'name':name,'codeSha256':c['CodeSha256'],'environmentAdditionKeys':list(item['environmentAdditions']),'scopedPolicy':policyName,'preservedUnrelatedPackageFiles':True};save();print(role+' legal consumer deployed',flush=True)
# Public immutable documents only; no phone body/secret/profile path is reached.
for audience in ['CUSTOMER','DRIVER','MERCHANT']:
 response=l.invoke(FunctionName=plan['registrationConsumers']['phone']['functionName'],Payload=json.dumps({'httpMethod':'GET','path':'/legal','queryStringParameters':{'audience':audience}}).encode());r=json.loads(response['Payload'].read());assert not response.get('FunctionError') and r['statusCode']==200,r['statusCode'];bundle=json.loads(r['body'])['bundle'];assert bundle['audience']==audience and bundle['revision']>=1
proof['directReadSmokePassed']=True;save()
resources=api.get_resources(restApiId='f44z33oz55',limit=500)['items'];assert not any(r['path']=='/legal' for r in resources);rootId=next(r['id'] for r in resources if r['path']=='/');r=api.create_resource(restApiId='f44z33oz55',parentId=rootId,pathPart='legal');rid=r['id'];api.put_method(restApiId='f44z33oz55',resourceId=rid,httpMethod='GET',authorizationType='NONE',apiKeyRequired=False)
arn='arn:aws:lambda:us-east-1:699561669180:function:'+plan['registrationConsumers']['phone']['functionName'];uri='arn:aws:apigateway:us-east-1:lambda:path/2015-03-31/functions/'+arn+'/invocations';api.put_integration(restApiId='f44z33oz55',resourceId=rid,httpMethod='GET',type='AWS_PROXY',integrationHttpMethod='POST',uri=uri)
l.add_permission(FunctionName=plan['registrationConsumers']['phone']['functionName'],StatementId='PublicLegalRead344',Action='lambda:InvokeFunction',Principal='apigateway.amazonaws.com',SourceArn=plan['publicRoute']['lambdaInvokeSourceArn'])
assert api.get_stage(restApiId='f44z33oz55',stageName='staging')['deploymentId']==proof['baseApiDeploymentId'],'Concurrent API deployment'
d=api.create_deployment(restApiId='f44z33oz55',stageName='staging',description='344 public published legal documents only');proof['apiDeploymentId']=d['id'];proof['publicRoute']={'path':'GET /legal','authorization':'NONE','resourceId':rid};proof['status']='BACKEND_DEPLOYED_REQUIRES_HTTP_VERIFICATION';save();print('Public reader deployed; no profile, policy or money rows written.',flush=True)
