"""Read-only route/deployment plan. Does not create or deploy API methods."""
import pathlib,json,importlib.util,hashlib
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113');API='ie7z8r4wc0'
def sha(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':'),default=str).encode()).hexdigest()
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();api=s.client('apigateway');lam=s.client('lambda');resources=[]
 for page in api.get_paginator('get_resources').paginate(restApiId=API,embed=['methods']):resources.extend(page['items'])
 previous=json.loads((O/'merchant-api-resources.private.json').read_text());assert sha(resources)==sha(previous),'API_CONFIGURATION_DRIFT'
 source=next(r for r in resources if r['path']=='/auth/branch-staff');parent=next(r for r in resources if r['path']=='/auth');assert not any(r['path']=='/auth/settlement-schedules' for r in resources)
 exported=api.get_export(restApiId=API,stageName='staging',exportType='swagger',parameters={'extensions':'integrations'})['body'].read();stage=json.loads(exported);(O/'merchant-stage-export.private.json').write_bytes(exported);(O/'merchant-stage-export.private.json').chmod(0o600)
 current={(r['path'],method.lower()) for r in resources for method in r.get('resourceMethods',{})};deployed={(path,method.replace('x-amazon-apigateway-any-method','any')) for path,value in stage['paths'].items() for method in value if method in ['get','post','put','delete','patch','options','head','x-amazon-apigateway-any-method']};assert current==deployed,'UNDEPLOYED_METHOD_DRIFT'
 # Compare execution/auth semantics too, not just method names. Ignore export-only defaults.
 for resource in resources:
  for verb,method in resource.get('resourceMethods',{}).items():
   deployed=stage['paths'][resource['path']].get(verb.lower(),stage['paths'][resource['path']].get('x-amazon-apigateway-any-method'))
   assert deployed is not None,'STAGE_METHOD_MISSING'
   a=method.get('methodIntegration',{});b=deployed.get('x-amazon-apigateway-integration',{})
   for field in ['type','httpMethod','uri','credentials','requestTemplates','requestParameters','contentHandling']:
    av=a.get(field);bv=b.get(field)
    if field=='type':av=str(av).upper();bv=str(bv).upper()
    if field in ['requestTemplates','requestParameters']:av=av or {};bv=bv or {}
    assert av==bv,'UNDEPLOYED_INTEGRATION_DRIFT '+resource['path']+' '+verb+' '+field
   security=deployed.get('security',stage.get('security',[]))
   auth=[stage.get('securityDefinitions',{}).get(name,{}).get('x-amazon-apigateway-authtype','').lower() for item in security for name in item]
   if method.get('authorizationType')=='COGNITO_USER_POOLS':assert 'cognito_user_pools' in auth,'UNDEPLOYED_AUTH_DRIFT'
   if method.get('authorizationType')=='NONE':assert not any(x in ['cognito_user_pools','custom','awssigv4'] for x in auth),'UNDEPLOYED_AUTH_DRIFT'
 methods={}
 for verb in ['GET','POST','OPTIONS']:
  method=api.get_method(restApiId=API,resourceId=source['id'],httpMethod=verb);integration=api.get_integration(restApiId=API,resourceId=source['id'],httpMethod=verb)
  if verb!='OPTIONS':
   assert method['authorizationType']=='COGNITO_USER_POOLS';assert integration['type']=='AWS_PROXY';assert ':function:order-receiver-regional-staging-unified-auth-v4-sam/invocations' in integration['uri']
  methods[verb]={'method':method,'integration':integration}
 policy=json.loads(lam.get_policy(FunctionName='order-receiver-regional-staging-unified-auth-v4-sam')['Policy']);(O/'merchant-gateway-invoke-policy.private.json').write_text(json.dumps(policy,indent=2));(O/'merchant-gateway-invoke-policy.private.json').chmod(0o600)
 stageinfo=api.get_stage(restApiId=API,stageName='staging');doc={'apiId':API,'stageName':'staging','parentId':parent['id'],'sourceResourceId':source['id'],'pathPart':'settlement-schedules','targetPath':'/auth/settlement-schedules','methods':methods,'originalStage':stageinfo,'resourceDigest':sha(resources),'currentMethodSetMatchesDeployment':True,'awsMutations':0}
 (O/'api-route-plan.private.json').write_text(json.dumps(doc,indent=2,default=str));(O/'api-route-plan.private.json').chmod(0o600)
 print(json.dumps({'apiId':API,'path':doc['targetPath'],'methods':list(methods),'cognitoAuthorizationPreserved':True,'existingMethodsMatchDeployment':True,'awsMutations':0}))
if __name__=='__main__':main()
