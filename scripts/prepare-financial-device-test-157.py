"""Read-only identity/obligation audit and preparation of one fresh scoped test. No AWS writes."""
import concurrent.futures,copy,datetime,hashlib,json,os,pathlib,subprocess,uuid
import boto3
from boto3.dynamodb.conditions import Key
from botocore.config import Config
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/financial-device-test-157');O.mkdir(mode=0o700,exist_ok=True);os.chmod(O,0o700)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=30,retries={'max_attempts':3,'mode':'standard'});lam=s.client('lambda',config=cfg);cog=s.client('cognito-idp',config=cfg);db=s.resource('dynamodb',config=cfg)
assert s.client('sts',config=cfg).get_caller_identity()['Account']=='699561669180'
def save(name,value):
 p=O/name;p.write_text(json.dumps(value,indent=2,default=str)+'\n');os.chmod(p,0o600)
def node(code,value=None):return json.loads(subprocess.check_output(['node','-e',code],cwd=R,input=json.dumps(value).encode() if value is not None else None))
names=node("console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))")
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:configs=list(pool.map(lambda n:lam.get_function_configuration(FunctionName=n),names))
scopes=[json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']) for c in configs];assert all(v==scopes[0] for v in scopes),'SCOPE_DRIFT'
old=scopes[0];phone='+9647800868280'
def identity(pool):
 users=cog.list_users(UserPoolId=pool,Filter='phone_number = "'+phone+'"',Limit=2)['Users'];assert len(users)==1 and users[0]['Enabled'],'TEST_IDENTITY_NOT_READY'
 attrs={a['Name']:a['Value'] for a in users[0]['Attributes']};assert attrs.get('phone_number_verified')=='true';return attrs['sub']
customer=identity('us-east-1_TpyyrVkEE');driver=identity('us-east-1_RGTqUXF5C');owner=identity('us-east-1_gtCR3ndzT')
branch='business_95ac73c9-feda-4207-9285-550aec61b94c';business=db.Table('WhizzMerchants_Businesses').get_item(Key={'businessId':branch},ConsistentRead=True)['Item'];assert business['ownerId']==owner and business['status']=='approved'
wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver,'sk':'META'},ConsistentRead=True)['Item'];live=db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId':driver},ConsistentRead=True).get('Item',{})
assert wallet['status']=='ACTIVE' and wallet['lockedBalance']==0 and wallet['availableBalance']>=25000,'DRIVER_WALLET_NOT_READY'
assert not live.get('currentOrderId') and not live.get('activeOrdersCount',0),'DRIVER_HAS_ACTIVE_ORDER'
now=datetime.datetime.now(datetime.timezone.utc);audits=[];unused=[]
for scope in old['scopes']:
 rows=[]
 for order in scope['orders']:
  oid=order['orderId'];saved=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True).get('Item');obligations={}
  for table in ['staging-Holds','WaveOffers_staging','WizzDispatchJobs_staging']:
   result=db.Table(table).query(KeyConditionExpression=Key('orderId').eq(oid),ConsistentRead=True,Limit=100);obligations[table]={'count':len(result.get('Items',[])),'hasContinuation':bool(result.get('LastEvaluatedKey'))}
  rows.append({'orderId':oid,'orderExists':bool(saved),'status':saved.get('status') if saved else None,'obligations':obligations})
 empty=all(not r['orderExists'] and all(v['count']==0 and not v['hasContinuation'] for v in r['obligations'].values()) for r in rows)
 expired=datetime.datetime.fromisoformat(scope['admitUntil'].replace('Z','+00:00'))<now
 audits.append({'id':scope['id'],'mode':scope['mode'],'expired':expired,'unused':empty,'orders':rows})
 if empty and expired and scope['mode']=='SCOPED' and all(o['branchId']==branch and o['customerSubjectId']==customer for o in scope['orders']):unused.append(scope)
save('scope-audit.private.json',audits)
assert unused,'NO_UNUSED_EXPIRED_SCOPE_SLOT'
source=unused[-1];selector_path=O/'selector.private.json'
if selector_path.exists():selector=json.loads(selector_path.read_text())
else:
 prior=json.loads(pathlib.Path('/private/tmp/finance103/selector.private.json').read_text());request=str(uuid.uuid4());selector={**prior,'branchId':branch,'requestId':request};selector['orderId']=node("const x=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(JSON.stringify(require('./backend/wallet-service/dist/deliveryQuoteOrder').orderIdFor(x.userId,x.requestId)))",selector);save('selector.private.json',selector)
assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item'),'FRESH_ORDER_EXISTS'
assert any(o['customerSubjectId']==customer for o in source['orders'])
candidate=copy.deepcopy(old);fresh=copy.deepcopy(source);fresh.update(id='fattoush-financial-host-157',version=1,mode='SCOPED',admitUntil=(now+datetime.timedelta(minutes=60)).isoformat(timespec='milliseconds').replace('+00:00','Z'),orders=[{'orderId':selector['orderId'],'branchId':branch,'customerSubjectId':customer}],drivers=[{'driverId':driver,'subjectId':driver}]);candidate['scopes']=[fresh if v['id']==source['id'] and v['version']==source['version'] else v for v in candidate['scopes']]
digest=node("console.log(JSON.stringify(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8')))))",candidate)
settings={
 'WaveSystem_CreateDispatchJob':{'DISPATCH_FINANCIAL_HOST_MODE':'REQUIRED','DISPATCH_CYCLE_MODE':'FINANCIAL_RESPONSES','DISPATCH_HOST_ACCOUNT_ID':'699561669180','FINANCIAL_DISPATCH_MODE':'REQUIRED','FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'WaveSystem_StartWave':{'DISPATCH_FINANCIAL_HOST_MODE':'REQUIRED','DISPATCH_CYCLE_MODE':'FINANCIAL_RESPONSES','DISPATCH_HOST_ACCOUNT_ID':'699561669180','FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'WaveSystem_HandleWaveTimeout':{'DISPATCH_FINANCIAL_HOST_MODE':'REQUIRED','DISPATCH_CYCLE_MODE':'FINANCIAL_RESPONSES','FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'staging-driver-financial-accept':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED','FINANCIAL_PUSH_VALIDATION_MODE':'REQUIRED'},
 'staging-cod-integration':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'staging-merchant-response-99':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'order-receiver-merchant-orders-staging-v1':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},
 'wizzcentral-notifications-staging-pushSendWaveOffer':{'PINNED_FINANCIAL_PUSH_MODE':'REQUIRED','PINNED_DISPATCH_ACCOUNT_ID':'699561669180'},
 'WizzUser-CreateOrder-staging':{'DELIVERY_PROMOTION_MODE':'REQUIRED'},
}
rows=[]
for c in configs:
 env=c['Environment']['Variables'];changes={'FINANCE_ROLLOUT_CONFIG':json.dumps(candidate,separators=(',',':')),'FINANCE_ROLLOUT_SHA256':digest,**settings.get(c['FunctionName'],{})};merged={**env,**changes};assert sum(len(k.encode())+len(v.encode()) for k,v in merged.items())<4096,'LAMBDA_ENVIRONMENT_SIZE_LIMIT'
 rows.append({'name':c['FunctionName'],'revisionId':c['RevisionId'],'codeSha256':c['CodeSha256'],'environmentSha256':hashlib.sha256(json.dumps(env,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'changes':changes})
offers=db.Table('staging-MerchantPlatform').query(KeyConditionExpression=Key('pk').eq('BRANCH#'+branch)&Key('sk').begins_with('COMMERCIAL#DELIVERY#'),ConsistentRead=True,Limit=25)
save('activation-candidate.private.json',{'part':157,'applied':False,'scope':candidate,'replacesOnlyUnusedScope':source['id'],'freshScopeId':fresh['id'],'functions':rows,'policyIndexCount':len(offers.get('Items',[])),'policyIndexContinuation':bool(offers.get('LastEvaluatedKey'))})
defines=json.loads(pathlib.Path('/private/tmp/finance103/user-dart-defines.private.json').read_text());defines['FINANCE_TEST_CHECKOUT_ATTEMPT']=json.dumps({'schemaVersion':1,'userId':selector['userId'],'branchId':branch,'requestId':selector['requestId']},separators=(',',':'));save('user-dart-defines.private.json',defines)
print(json.dumps({'prepared':True,'hosts':len(rows),'newOrders':1,'replacesUnusedExpiredScope':True,'historicalScopePinsPreserved':True,'identitiesVerified':3,'driverAvailable':str(wallet['availableBalance']),'driverLocked':str(wallet['lockedBalance']),'deliveryPolicyIndexes':len(offers.get('Items',[])),'admitUntil':fresh['admitUntil'],'applied':False}))
