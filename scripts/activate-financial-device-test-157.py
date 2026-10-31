"""Activate one fresh, explicitly scoped staging device test; no IAM/table/balance writes."""
import datetime,hashlib,json,os,pathlib,sys,time,boto3
from botocore.config import Config
from boto3.dynamodb.conditions import Key
O=pathlib.Path('/private/tmp/financial-device-test-157');candidate=json.loads((O/'activation-candidate.private.json').read_text());apply=sys.argv[1:]==['--apply'];assert not sys.argv[1:] or apply
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=30,retries={'mode':'standard','max_attempts':3});lam=s.client('lambda',config=cfg);db=s.resource('dynamodb',config=cfg)
assert s.client('sts',config=cfg).get_caller_identity()['Account']=='699561669180'
def digest(v):return hashlib.sha256(json.dumps(v,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def save(name,v):
 p=O/name;p.write_text(json.dumps(v,indent=2)+'\n');os.chmod(p,0o600)
fresh=next(v for v in candidate['scope']['scopes'] if v['id']==candidate['freshScopeId']);assert len(fresh['orders'])==1 and len(fresh['drivers'])==1
until=datetime.datetime.fromisoformat(fresh['admitUntil'].replace('Z','+00:00'));now=datetime.datetime.now(datetime.timezone.utc);assert datetime.timedelta(minutes=15)<until-now<=datetime.timedelta(minutes=60),'REFRESH_REVIEWED_WINDOW_REQUIRED'
order=fresh['orders'][0];assert order['branchId']=='business_95ac73c9-feda-4207-9285-550aec61b94c'
assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+order['orderId'],'SK':'META'},ConsistentRead=True).get('Item'),'NEW_ORDER_EXISTS'
configs={}
for row in candidate['functions']:
 c=lam.get_function_configuration(FunctionName=row['name']);env=c['Environment']['Variables'];assert c['RevisionId']==row['revisionId'] and c['CodeSha256']==row['codeSha256'] and digest(env)==row['environmentSha256'],'LIVE_DRIFT '+row['name'];configs[row['name']]=c
 original=json.loads(env['FINANCE_ROLLOUT_CONFIG'])
 # Historical drain pins must remain byte-for-byte; only a never-used expired slot is replaced.
 for scope in original['scopes']:
  if scope['id']==candidate['replacesOnlyUnusedScope']:
   assert scope['mode']=='SCOPED' and datetime.datetime.fromisoformat(scope['admitUntil'].replace('Z','+00:00'))<now
   for old in scope['orders']:
    oid=old['orderId'];assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True).get('Item')
    for table in ['staging-Holds','WaveOffers_staging','WizzDispatchJobs_staging']:
     r=db.Table(table).query(KeyConditionExpression=Key('orderId').eq(oid),ConsistentRead=True,Limit=1);assert not r.get('Items') and not r.get('LastEvaluatedKey'),'OLD_SCOPE_HAS_OBLIGATIONS'
  else:assert scope in candidate['scope']['scopes'],'HISTORY_CHANGED'
driver=fresh['drivers'][0]['driverId'];wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver,'sk':'META'},ConsistentRead=True)['Item'];assert wallet['status']=='ACTIVE' and wallet['lockedBalance']==0 and wallet['availableBalance']>=25000
state=db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId':driver},ConsistentRead=True).get('Item',{});assert not state.get('currentOrderId') and not state.get('activeOrdersCount',0)
print(json.dumps({'preflight':'PASS','hosts':len(configs),'newOrders':1,'historicalPinsPreserved':True,'walletUnchanged':True,'applyRequested':apply}),flush=True)
if not apply:sys.exit(0)
assert not (O/'activation-publication.private.json').exists(),'ACTIVATION_ALREADY_STARTED_REVIEW_RECEIPT'
proof={'part':157,'status':'STARTING','scopeId':fresh['id'],'admitUntil':fresh['admitUntil'],'functions':[],'tableWrites':False,'iamChanges':False,'balanceChanges':False};save('activation-publication.private.json',proof)
names=[r['name'] for r in candidate['functions'] if r['name'] not in ['WaveSystem_CreateDispatchJob','WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging']]+['WaveSystem_CreateDispatchJob','WizzUser-DeliveryQuotes-staging','WizzUser-CreateOrder-staging']
try:
 for name in names:
  row=next(r for r in candidate['functions'] if r['name']==name);before=lam.get_function_configuration(FunctionName=name);env=before['Environment']['Variables'];assert before['RevisionId']==row['revisionId'] and digest(env)==row['environmentSha256'],'MID_ACTIVATION_DRIFT'
  merged={**env,**row['changes']};step={'name':name,'status':'APPLYING','previousValues':{k:env.get(k) for k in row['changes']},'expectedValues':row['changes'],'baseRevisionId':before['RevisionId']};proof['functions'].append(step);save('activation-publication.private.json',proof)
  lam.update_function_configuration(FunctionName=name,RevisionId=before['RevisionId'],Environment={'Variables':merged})
  for attempt in range(60):
   after=lam.get_function_configuration(FunctionName=name)
   if after.get('LastUpdateStatus')=='Successful':break
   assert after.get('LastUpdateStatus')!='Failed','CONFIGURATION_UPDATE_FAILED';time.sleep(2)
  assert after.get('LastUpdateStatus')=='Successful' and after['Environment']['Variables']==merged and after['CodeSha256']==before['CodeSha256'],'POST_ACTIVATION_MISMATCH'
  step.update(status='VERIFIED',revisionId=after['RevisionId']);save('activation-publication.private.json',proof);print(json.dumps({'configured':name}),flush=True)
 proof['status']='ACTIVE_ONE_ORDER';save('activation-publication.private.json',proof);print(json.dumps({'activatedHosts':len(names),'newOrders':1,'admitUntil':fresh['admitUntil'],'balanceChanges':False}),flush=True)
except Exception:
 proof['status']='STOPPED_REVIEW_REQUIRED';save('activation-publication.private.json',proof);raise
