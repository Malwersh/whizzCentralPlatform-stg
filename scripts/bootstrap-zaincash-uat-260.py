"""Initialize disabled UAT settings from already stored official sandbox credentials.
Provenance is the actual AWS setup principal, not an invented finance employee.
No transaction/init call, payment, approval or wallet credit is performed.
"""
import boto3,json,uuid,datetime,urllib.request,urllib.parse,pathlib
R=pathlib.Path(__file__).resolve().parents[1];s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');ddb=s.resource('dynamodb');table=ddb.Table('staging-IdempotencyKeys');key={'idempotencyKey':'ZC#CONFIG','sk':'META'}
if table.get_item(Key=key,ConsistentRead=True).get('Item'):
 print('EXISTING_SETTINGS_PRESERVED');raise SystemExit(0)
actor=s.client('sts').get_caller_identity()['Arn'];secrets=s.client('secretsmanager');old=json.loads(secrets.get_secret_value(SecretId='wizz/staging/payments/zaincash/sandbox')['SecretString']);credentials={k:old.get(k,'')for k in ['clientId','clientSecret','apiKey']};assert all(isinstance(credentials[k],str)and len(credentials[k])>=4 for k in ['clientId','clientSecret'])
verified=False
try:
 body=urllib.parse.urlencode({'grant_type':'client_credentials','client_id':credentials['clientId'],'client_secret':credentials['clientSecret'],'scope':'payment:read payment:write'}).encode()
 response=urllib.request.urlopen(urllib.request.Request('https://pg-api-uat.zaincash.iq/oauth2/token',data=body,headers={'Content-Type':'application/x-www-form-urlencoded'}),timeout=10)
 verified=bool(json.load(response).get('access_token'))
except Exception:pass # Never log provider credentials or raw responses.
secret=secrets.create_secret(Name='wizz/staging/payments/zaincash/gateway-uat-'+str(uuid.uuid4()),SecretString=json.dumps(credentials));at=datetime.datetime.now(datetime.timezone.utc).isoformat()
config={**key,'revision':1,'mode':'UAT','apiOrigin':'https://pg-api-uat.zaincash.iq','checkoutHosts':['pg-api-uat.zaincash.iq','pg-uat.zaincash.iq'],'minimum':25000,'maximum':500000,'secretId':secret['ARN'],'secretVersion':secret['VersionId'],'enabled':False,'verifiedAt':at if verified else None,'liveAcceptance':False,'pilotAuthorized':False,'pilotDriverIds':[],'updatedBy':actor,'updatedAt':at,'setupProvenance':'AWS_SETUP_EXISTING_OFFICIAL_SANDBOX_CREDENTIALS'}
from boto3.dynamodb.types import TypeSerializer
ser=TypeSerializer();marshal=lambda x:{k:ser.serialize(v)for k,v in x.items()}
audit={'datePartition':'date#'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d'),'sk':at+'#'+str(uuid.uuid4()),'action':'ZAINCASH_DISABLED_UAT_BOOTSTRAP','actorId':actor,'environment':'UAT','credentialsSource':'EXISTING_SERVER_SIDE_SANDBOX_SECRET','oauthVerified':verified,'liveEnabled':False}
s.client('dynamodb').transact_write_items(TransactItems=[{'Put':{'TableName':table.name,'Item':marshal(config),'ConditionExpression':'attribute_not_exists(idempotencyKey)'}},{'Put':{'TableName':'staging-AuditLog','Item':marshal(audit)}}])
record={'status':'DISABLED_UAT_PREPARED','oauthAuthenticationPassed':verified,'configuredFromExistingServerSecret':True,'credentialsPrintedOrSavedLocally':False,'realAwsSetupProvenance':True,'uatPaymentsCreated':0,'livePaymentsCreated':0,'walletCredits':0,'liveEnabled':False,'uatEnabled':False}
(R/'docs/zaincash-uat-bootstrap-260.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
