"""Read-only verification plus negative-auth probes. Never invokes deletion workers."""
import pathlib,json,importlib.util,urllib.request,urllib.error,zipfile,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def main():
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();lam=s.client('lambda');amp=s.client('amplify');api=s.client('apigateway');iam=s.client('iam')
 publication=json.loads((O/'code-publication.json').read_text());functions=[]
 for row in publication['functions']:
  cfg=lam.get_function_configuration(FunctionName=row['name']);before=json.loads((O/(row['host']+'.config.private.json')).read_text());assert cfg['CodeSha256']==row['codeSha256'] and cfg['State']=='Active' and cfg['LastUpdateStatus']=='Successful';assert cfg.get('Environment',{})==before.get('Environment',{}),'FINANCIAL_FLAGS_OR_ENV_CHANGED'
  assert cfg.get('Environment',{}).get('Variables',{}).get('SETTLEMENT_SCHEDULE_ADMIN_ENABLED')!='true'
  functions.append({'name':row['name'],'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'state':cfg['State'],'configurationPreserved':True})
 ui=json.loads((O/'frontend-publication.json').read_text());assert amp.get_job(appId=ui['appId'],branchName=ui['branchName'],jobId=ui['jobId'])['job']['summary']['status']=='SUCCEED'
 paths=['pages/finance.html','pages/merchants.html','settlement-schedules.js','assets/js/rbac.js','notification-sounds.js','assets/sounds/first_nitification_sound.wav','assets/sounds/driver_original.wav'];matched=[]
 with zipfile.ZipFile(O/'frontend.candidate.zip') as z:
  for path in paths:
   data=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+path,timeout=45).read();assert data==z.read(path),'HOSTED_BYTES_MISMATCH '+path;matched.append(path)
 checks=[]
 for event,expected in [({'httpMethod':'GET','path':'/staff/settlement-schedules','headers':{},'queryStringParameters':{'branchId':'review-113'}},401),({'httpMethod':'GET','path':'/staff/settlement-schedules/branches','headers':{},'queryStringParameters':{}},401),({'action':'settlement_schedule_owner','accessToken':'invalid-negative-test','httpMethod':'GET','input':{'branchId':'review-113'}},503)]:
  out=lam.invoke(FunctionName='staging-wizz-staff-service',InvocationType='RequestResponse',Payload=json.dumps(event).encode());result=json.load(out['Payload']);assert not out.get('FunctionError');assert result['statusCode']==expected;checks.append({'path':event.get('path',event.get('action')),'statusCode':result['statusCode']})
 route=json.loads((O/'api-route-publication.json').read_text());assert api.get_stage(restApiId=route['apiId'],stageName='staging')['deploymentId']==route['deploymentId']
 for verb in ['GET','POST']:assert api.get_method(restApiId=route['apiId'],resourceId=route['resourceId'],httpMethod=verb)['authorizationType']=='COGNITO_USER_POOLS'
 url='https://ie7z8r4wc0.execute-api.us-east-1.amazonaws.com/staging/auth/settlement-schedules'
 try:urllib.request.urlopen(url,timeout=30);raise AssertionError('ANONYMOUS_API_OPEN')
 except urllib.error.HTTPError as e:assert e.code==401;checks.append({'path':'merchant /auth/settlement-schedules','statusCode':e.code})
 out=urllib.request.urlopen(urllib.request.Request(url,method='OPTIONS',headers={'Cache-Control':'no-cache','Origin':'https://staging.d2vmebm1e1n95m.amplifyapp.com','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'authorization,access-token'}),timeout=30);assert out.status==200 and 'access-token' in out.headers.get('Access-Control-Allow-Headers','').lower()
 reviewed=json.loads((ROOT/'backend/finance-settlement-retention-access.staging.json').read_text());assert iam.get_role_policy(RoleName=reviewed['targetRole'].rsplit('/',1)[1],PolicyName=reviewed['policyName'])['PolicyDocument']==reviewed['policyDocument']
 proof={'verifiedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':functions,'frontendJobId':ui['jobId'],'hostedFilesMatched':matched,'negativeAuthChecks':checks,'merchantApiCognitoPreserved':True,'corsAccessTokenHeader':True,'approvedPermissionVerified':True,'activation':False,'balancesChanged':False,'existingOrderTest':'PAUSED_PENDING_OTP','authenticatedOwnerFlow':'NOT_TESTED_PENDING_OTP'}
 (O/'verification.json').write_text(json.dumps(proof,indent=2));(O/'verification.json').chmod(0o600);print(json.dumps({'functionsVerified':len(functions),'frontendJobId':ui['jobId'],'hostedFilesMatched':len(matched),'negativeAuthChecks':checks,'creationGateEnabled':False,'balancesChanged':False}))
if __name__=='__main__':main()
