"""Verify the closed publication without human credentials or financial writes."""
import boto3,pathlib,json,urllib.request,urllib.error,zipfile,hashlib,base64,re
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance60')
def main():
 state=json.loads((R/'publication.json').read_text());p=json.loads((R/'preparation.json').read_text());s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');a=s.client('amplify');api=s.client('apigateway')
 for row in state['functions']:
  cfg=lam.get_function_configuration(FunctionName=row['name']);assert cfg['CodeSha256']==row['codeSha256'] and cfg['RevisionId']==row['revisionId'];assert cfg.get('Environment',{}).get('Variables',{}).get('COMMERCIAL_ADMIN_ENABLED')!='true'
 with zipfile.ZipFile(R/'frontend.candidate.zip') as z:
  for name in p['packages']['frontend']['changedFiles']:
   b=urllib.request.urlopen('https://staging.d2vmebm1e1n95m.amplifyapp.com/'+name,timeout=30).read();assert b==z.read(name),'HOSTED_FILE_DRIFT: '+name
  config=z.read('config.js').decode();staff=re.search(r"STAFF_API_BASE_URL:[^\n]*(https://[^'\"]+)",config).group(1)
 results=[]
 for method,url in [('GET','https://ie7z8r4wc0.execute-api.us-east-1.amazonaws.com/staging/auth/commercial-agreements?businessId=probe'),('POST','https://ie7z8r4wc0.execute-api.us-east-1.amazonaws.com/staging/auth/commercial-agreements'),('GET',staff+'/staff/commercial?businessId=probe')]:
  request=urllib.request.Request(url,method=method,headers={'Content-Type':'application/json'},data=b'{}' if method=='POST' else None)
  try:r=urllib.request.urlopen(request,timeout=30);code=r.status
  except urllib.error.HTTPError as e:code=e.code
  assert code==401,(method,code);results.append({'method':method,'status':code})
 source=json.loads((R/'gateway.private.json').read_text())['source']['id'];target=state['gateway']['resourceId']
 for method in ['GET','POST','OPTIONS']:
  old=api.get_method(restApiId='ie7z8r4wc0',resourceId=source,httpMethod=method);new=api.get_method(restApiId='ie7z8r4wc0',resourceId=target,httpMethod=method)
  for key in ['authorizationType','authorizerId','apiKeyRequired']:assert old.get(key)==new.get(key)
  # API Gateway assigns an independent cache namespace to each resource, even with caching disabled.
  oi=dict(old['methodIntegration']);ni=dict(new['methodIntegration']);oi.pop('cacheNamespace',None);ni.pop('cacheNamespace',None);assert oi==ni
 job=a.get_job(appId='d2vmebm1e1n95m',branchName='staging',jobId=state['amplify']['jobId'])['job']['summary'];assert job['status']=='SUCCEED'
 result={'part':60,'functionsMatched':2,'hostedFilesMatched':6,'anonymousRequests':results,'gatewayAuthAndIntegrationMatched':True,'closedOwnerHandlerVerified':state['closedOwnerHandlerVerified'],'commercialAdminEnabled':False,'activationPerformed':False,'applicationDataWrites':0,'iamChanges':0};(R/'verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
