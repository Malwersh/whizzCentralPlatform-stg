"""Read-only verification plus disabled-handler calls; no order, wallet or identity writes."""
import boto3,json,urllib.request,urllib.error
from pathlib import Path
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');api=s.client('apigateway');root=Path('/private/tmp/cod32-release');manifest=json.load(open(root/'manifest.json'));report={'financialActivation':'OFF','functions':[]}
for f in manifest['functions']:
 c=l.get_function_configuration(FunctionName=f['name']);assert c['CodeSha256']==f['codeSha256'];env=c.get('Environment',{}).get('Variables',{});assert all(v=='OFF' for k,v in env.items() if k.startswith('FINANCIAL_') and k.endswith('_MODE'))
 if f['name']!='staging-wizz-staff-service':assert env['DELIVERY_OPERATIONS_MODE']=='CENTRAL'
 if f['name']=='WizzUser-DeliveryQuotes-staging':assert env['DELIVERY_QUOTES_ENABLED']=='false'
 report['functions'].append({'name':f['name'],'digestMatches':True,'central':env.get('DELIVERY_OPERATIONS_MODE')=='CENTRAL'})
def invoke(name,event):
 r=l.invoke(FunctionName=name,Payload=json.dumps(event).encode());assert not r.get('FunctionError');return json.load(r['Payload'])
r=invoke('staging-driver-financial-accept',{'accessToken':'synthetic-invalid-token','action':'accept','body':{}});assert r['statusCode']==409 and r['code']=='FINANCIAL_DISPATCH_DISABLED';report['writerClosed']=True
r=invoke('WizzUser-DeliveryQuotes-staging',{'httpMethod':'GET','headers':{},'queryStringParameters':{}});assert r['statusCode']==503 and json.loads(r['body'])['code']=='QUOTES_NOT_ENABLED';report['quoteClosed']=True
checks=[]
for method in ['GET','POST']:
 req=urllib.request.Request('https://7oum9md7v6.execute-api.us-east-1.amazonaws.com/staging/staff/settings/delivery-operations',method=method,data=b'{}' if method=='POST' else None,headers={'Content-Type':'application/json'})
 try:urllib.request.urlopen(req,timeout=30);raise AssertionError('ANONYMOUS_REQUEST_ALLOWED')
 except urllib.error.HTTPError as e:assert e.code==401;checks.append({'method':method,'statusCode':e.code})
report['anonymousSettings']=checks;stages=[]
for aid,expected in [('4jut6787c8','tcrbil'),('ie7z8r4wc0','kvesq3')]:
 stage=api.get_stage(restApiId=aid,stageName='staging');assert stage['deploymentId']==expected;stages.append({'apiId':aid,'deploymentId':expected})
report['unchangedStages']=stages
row=s.resource('dynamodb').Table('staging-PlatformStaff').get_item(Key={'pk':'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS','sk':'CURRENT'},ConsistentRead=True)['Item'];assert row['version']==1 and row['values']=={'quoteMaxPerCustomerPerMinute':5,'driverOfferTtlSeconds':60,'driverPositionMaxAgeSeconds':120,'reassignmentWindowSeconds':300,'maximumWaves':4};report['approvedPolicyVersion']=1;report['humanOrdersFundsAndGrantsChanged']=False
(root/'verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
