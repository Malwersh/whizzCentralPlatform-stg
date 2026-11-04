"""Complete approved schedule route's OPTIONS-only CORS response."""
import pathlib,json,importlib.util,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def canonical(rows):return json.dumps(sorted(rows,key=lambda x:x['path']),sort_keys=True,separators=(',',':'),default=str)
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();api=s.client('apigateway');p=json.loads((O/'api-route-publication.json').read_text());args={'restApiId':p['apiId'],'resourceId':p['resourceId'],'httpMethod':'OPTIONS'}
 assert p['apiId']=='ie7z8r4wc0' and p['path']=='/auth/settlement-schedules';assert api.get_stage(restApiId=p['apiId'],stageName='staging')['deploymentId']==p['deploymentId'],'STAGE_DRIFT'
 def unrelated():
  rows=[]
  for page in api.get_paginator('get_resources').paginate(restApiId=p['apiId'],embed=['methods']):rows.extend(r for r in page['items'] if r['id']!=p['resourceId'])
  return rows
 before=unrelated();assert canonical(before)==canonical(json.loads((O/'merchant-api-resources.private.json').read_text()))
 headers={'Access-Control-Allow-Origin':"'*'",'Access-Control-Allow-Methods':"'GET,POST,OPTIONS'",'Access-Control-Allow-Headers':"'Content-Type,Authorization,Access-Token,X-Amz-Date,X-Api-Key,X-Amz-Security-Token'"}
 api.put_integration(**args,type='MOCK',requestTemplates={'application/json':'{"statusCode":200}'},passthroughBehavior='WHEN_NO_MATCH')
 api.put_method_response(**args,statusCode='200',responseParameters={'method.response.header.'+k:True for k in headers},responseModels={})
 api.put_integration_response(**args,statusCode='200',responseParameters={'method.response.header.'+k:v for k,v in headers.items()},responseTemplates={'application/json':''})
 assert canonical(unrelated())==canonical(before)
 for verb in ['GET','POST']:assert api.get_method(restApiId=p['apiId'],resourceId=p['resourceId'],httpMethod=verb)['authorizationType']=='COGNITO_USER_POOLS'
 deployment=api.create_deployment(restApiId=p['apiId'],stageName='staging',description='Approved settlement release 113: complete OPTIONS Access-Token header')
 p['initialDeploymentId']=p['deploymentId'];p['deploymentId']=deployment['id'];p['corsRepairedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();p['optionsMockOnly']=True;(O/'api-route-publication.json').write_text(json.dumps(p,indent=2));print(json.dumps({'path':p['path'],'optionsMockOnly':True,'existingPathsPreserved':True,'getPostCognitoPreserved':True,'activation':False}))
if __name__=='__main__':main()
