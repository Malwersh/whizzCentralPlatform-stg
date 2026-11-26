#!/usr/bin/env python3
"""Prepare the standalone COD stack. Existing API, environment and stack templates are never changed."""
import json,sys,hashlib
from pathlib import Path
def prepare(audit,candidates,bucket,prefix):
 out=Path(candidates);manifest=json.loads((out/'manifest.json').read_text());assert manifest['account']=='699561669180' and manifest['activation']=='OFF'
 assert bucket=='aws-sam-cli-managed-default-samclisourcebucket-c0s0eilxsprc' and prefix.startswith('cod26/')
 source=Path(__file__).resolve().parent.parent/'backend/wallet-service/cod-lifecycle.staging.json';template=json.loads(source.read_text());uploads=[];parameters={}
 for f in manifest['functions']:
  file=out/(f['name']+'.candidate.zip');digest=hashlib.sha256(file.read_bytes()).hexdigest();key=prefix+'/code/'+f['name']+'/'+digest+'.zip';uploads.append({'path':str(file),'key':key,'sha256':digest,'name':f['name']})
  if f.get('newFunction'):
   p=template['Resources'][f['logicalId']]['Properties'];p['CodeUri']={'Bucket':bucket,'Key':key};p['Handler']='index.'+('financialAcceptanceHandler' if f['logicalId']=='DriverFinancialAcceptanceFunction' else 'handler')
  else:
   param='Cod26'+f['logicalId']+'RoleName'
   if param in template['Parameters']:parameters[param]=f['role'].split('/')[-1]
 route=json.loads((Path(audit)/'route-info.json').read_text());assert route['apiId']=='ie7z8r4wc0' and route['providerARNs']==['arn:aws:cognito-idp:us-east-1:699561669180:userpool/us-east-1_gtCR3ndzT']
 parameters.update({'MerchantRestApiId':route['apiId'],'MerchantAuthParentResourceId':route['parentId'],'MerchantCognitoAuthorizerId':route['authorizerId']})
 assert set(parameters)==set(template['Parameters'])
 dest=out/'standalone.template.json';dest.write_text(json.dumps(template,indent=2)+'\n');digest=hashlib.sha256(dest.read_bytes()).hexdigest();uploads.append({'path':str(dest),'key':prefix+'/templates/staging-cod-lifecycle/'+digest+'.json','sha256':digest,'stack':'staging-cod-lifecycle'})
 plan={'schemaVersion':1,'account':'699561669180','region':'us-east-1','bucket':bucket,'prefix':prefix,'uploads':uploads,'stack':'staging-cod-lifecycle','parameters':parameters,'existingEnvironmentUpdates':False,'existingApiUpdates':False,'newMerchantRoutes':True,'stageSwitchRequired':True,'previousStageDeploymentId':route['stageDeploymentId'],'newFlags':'OFF','newScheduleEnabled':False,'requiresChangeSetReview':True}
 (out/'deployment-plan.json').write_text(json.dumps(plan,indent=2)+'\n');return plan
if __name__=='__main__':
 plan=prepare(*sys.argv[1:]);print(json.dumps({'stack':plan['stack'],'existingEnvironmentUpdates':False,'newFlags':plan['newFlags']}))
