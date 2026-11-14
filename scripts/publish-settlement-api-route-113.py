"""Publish only the approved merchant schedule path using existing Cognito auth."""
import pathlib,json,importlib.util,datetime,fnmatch
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),default=str)
def resources(api,apiId):
 rows=[]
 for page in api.get_paginator('get_resources').paginate(restApiId=apiId,embed=['methods']):rows.extend(page['items'])
 return sorted(rows,key=lambda r:r['path'])
def main():
 plan=json.loads((O/'api-route-plan.private.json').read_text());assert plan['currentMethodSetMatchesDeployment'];assert len(json.loads((O/'code-publication.json').read_text())['functions'])==4
 assert not (O/'api-route-publication.json').exists(),'API_PUBLICATION_ALREADY_STARTED'
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();api=s.client('apigateway');lam=s.client('lambda');apiId=plan['apiId'];assert apiId=='ie7z8r4wc0'
 before=sorted(json.loads((O/'merchant-api-resources.private.json').read_text()),key=lambda r:r['path']);assert canonical(resources(api,apiId))==canonical(before),'LIVE_API_DRIFT'
 assert api.get_stage(restApiId=apiId,stageName='staging')['deploymentId']==plan['originalStage']['deploymentId'],'LIVE_STAGE_DRIFT'
 policy=json.loads(lam.get_policy(FunctionName='order-receiver-regional-staging-unified-auth-v4-sam')['Policy'])
 for verb in ['GET','POST','OPTIONS']:
  arn='arn:aws:execute-api:us-east-1:699561669180:'+apiId+'/staging/'+verb+'/auth/settlement-schedules'
  assert any(x.get('Effect')=='Allow' and x.get('Principal',{}).get('Service')=='apigateway.amazonaws.com' and fnmatch.fnmatchcase(arn,x.get('Condition',{}).get('ArnLike',{}).get('AWS:SourceArn','')) for x in policy['Statement']),'NEW_INVOKE_PERMISSION_NEEDED'
 created=api.create_resource(restApiId=apiId,parentId=plan['parentId'],pathPart='settlement-schedules');resourceId=created['id'];proof={'apiId':apiId,'stageName':'staging','resourceId':resourceId,'path':'/auth/settlement-schedules','methods':[],'baseDeploymentId':plan['originalStage']['deploymentId'],'activation':False}
 def save():
  (O/'api-route-publication.json').write_text(json.dumps(proof,indent=2,default=str));(O/'api-route-publication.json').chmod(0o600)
 save()
 for verb,source in plan['methods'].items():
  method=source['method'];integration=source['integration']
  if verb=='OPTIONS':
   headers={'Access-Control-Allow-Origin':"'*'",'Access-Control-Allow-Methods':"'GET,POST,OPTIONS'",'Access-Control-Allow-Headers':"'Content-Type,Authorization,Access-Token,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"}
   method={'authorizationType':'NONE','apiKeyRequired':False,'methodResponses':{'200':{'responseParameters':{'method.response.header.'+k:True for k in headers},'responseModels':{}}}}
   integration={'type':'MOCK','requestTemplates':{'application/json':'{"statusCode":200}'},'passthroughBehavior':'WHEN_NO_MATCH','integrationResponses':{'200':{'statusCode':'200','responseParameters':{'method.response.header.'+k:v for k,v in headers.items()},'responseTemplates':{'application/json':''}}}}
  methodArgs={k:method[k] for k in ['authorizationType','authorizerId','apiKeyRequired','requestParameters','requestModels','requestValidatorId','authorizationScopes'] if k in method}
  if verb!='OPTIONS':assert methodArgs['authorizationType']=='COGNITO_USER_POOLS'
  api.put_method(restApiId=apiId,resourceId=resourceId,httpMethod=verb,**methodArgs)
  integrationArgs={k:integration[k] for k in ['type','uri','credentials','requestParameters','requestTemplates','passthroughBehavior','cacheKeyParameters','contentHandling','timeoutInMillis','connectionType','connectionId','tlsConfig'] if k in integration}
  if integration.get('httpMethod'):integrationArgs['integrationHttpMethod']=integration['httpMethod']
  api.put_integration(restApiId=apiId,resourceId=resourceId,httpMethod=verb,**integrationArgs)
  for code,response in method.get('methodResponses',{}).items():api.put_method_response(restApiId=apiId,resourceId=resourceId,httpMethod=verb,statusCode=code,**{k:response[k] for k in ['responseParameters','responseModels'] if k in response})
  for code,response in integration.get('integrationResponses',{}).items():
   args={k:response[k] for k in ['selectionPattern','responseParameters','responseTemplates','contentHandling'] if k in response}
   if verb=='OPTIONS' and 'method.response.header.Access-Control-Allow-Headers' in args.get('responseParameters',{}):
    args['responseParameters']['method.response.header.Access-Control-Allow-Headers']="'Content-Type,Authorization,Access-Token,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"
   api.put_integration_response(restApiId=apiId,resourceId=resourceId,httpMethod=verb,statusCode=response.get('statusCode',code),**args)
  proof['methods'].append(verb);save()
 after=resources(api,apiId);assert canonical([r for r in after if r['id']!=resourceId])==canonical(before),'UNRELATED_API_CONFIGURATION_CHANGED'
 for verb in ['GET','POST']:assert api.get_method(restApiId=apiId,resourceId=resourceId,httpMethod=verb)['authorizationType']=='COGNITO_USER_POOLS'
 deployment=api.create_deployment(restApiId=apiId,stageName='staging',description='Approved settlement schedule route 113; no financial flags changed')
 proof['deploymentId']=deployment['id'];proof['publishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();save();print(json.dumps({'path':proof['path'],'methods':proof['methods'],'deployed':True,'cognitoAuthorizationPreserved':True,'activation':False}))
if __name__=='__main__':main()
