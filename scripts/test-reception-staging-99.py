"""Exercise new stream/cron worker with uniquely tagged, cash-only zero-value fixtures.
No customer identity, push recipient, driver, wallet or ledger record is created/changed.
Fixtures are removed only by exact keys and matching testRunId; audit proof remains.
"""
from pathlib import Path
import json,time,uuid,datetime,importlib.util
R=Path(__file__).resolve().parents[1];O=Path('/private/tmp/finance98');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);db=m.session().resource('dynamodb');run='reception99-'+uuid.uuid4().hex[:12];now=datetime.datetime.now(datetime.timezone.utc);iso=lambda d:d.isoformat(timespec='milliseconds').replace('+00:00','Z');fixtures=[];ids={};results={'testRunId':run,'financialWrites':False};out=O/'staging-reception99-test.json'
def row(table,value,key):fixtures.append((table,key));value['testRunId']=run;db.Table(table).put_item(Item=value,ConditionExpression='attribute_not_exists('+next(iter(key))+')')
def get(table,key):return db.Table(table).get_item(Key=key,ConsistentRead=True).get('Item',{})
try:
 for kind in ['auto','expire','resume']:
  branch=run+'-'+kind;owner=run+'-owner';ids[kind]={'branch':branch};at=now-datetime.timedelta(minutes=16) if kind=='resume' else now;pause=run+'-pause'
  b={'businessId':branch,'businessName':'Automated zero-value reception fixture','ownerId':owner,'cognitoUserId':owner,'status':'approved','isActive':True,'acceptingOrders':kind!='resume','onboardingSchemaVersion':1,'onboardingComplete':True,'orderReceptionSettings':{'schemaVersion':1,'autoAccept':True,'defaultPreparationMinutes':20}}
  if kind=='resume':b.update(orderPauseId=pause,ordersPausedUntil=iso(now-datetime.timedelta(seconds=1)),lastStatusUpdate=iso(at))
  row('WhizzMerchants_Businesses',b,{'businessId':branch})
  if kind=='resume':
   operation='MERCHANT_RESUME#'+branch+'#'+pause;row('staging-WalletLifecycle',{'operationId':operation,'kind':'MERCHANT_RESUME','branchId':branch,'ownerId':owner,'pauseId':pause,'pausedAt':iso(at),'status':'PENDING','queuePartition':'MERCHANT_RESPONSE','nextAttemptAt':int(time.time())-1},{'operationId':operation});ids[kind]['operation']=operation;continue
  oid=run+'-'+kind;created=now if kind=='auto' else now-datetime.timedelta(seconds=301);deadline=created+datetime.timedelta(seconds=300);operation='MERCHANT_RESPONSE#'+oid;ids[kind].update(order=oid,operation=operation)
  row('staging-WalletLifecycle',{'operationId':operation,'kind':'MERCHANT_RESPONSE','merchantResponseSchemaVersion':1,'orderId':oid,'branchId':branch,'ownerId':owner,'status':'PENDING','queuePartition':'MERCHANT_RESPONSE','nextAttemptAt':int(time.time())-1},{'operationId':operation})
  row('WizzOrders',{'PK':'ORDER#'+oid,'SK':'META','orderId':oid,'storeId':branch,'businessId':branch,'status':'pending','storeStatus':branch+'#pending#b0','createdAt':iso(created),'paymentMethod':'cash','paymentStatus':'pending','holdId':None,'holdAmount':0,'holdStatus':'NONE','merchantAcceptanceDeadlineAt':iso(deadline),'merchantResponsePolicy':{'schemaVersion':1,'acceptanceSeconds':300,'autoAccept':kind=='auto','defaultPreparationMinutes':20},'deliveryQuote':{'route':{'durationSeconds':180}},'totalAmount':0,'items':[]},{'PK':'ORDER#'+oid,'SK':'META'})
 end=time.time()+120
 while time.time()<end:
  statuses={k:get('WizzOrders',{'PK':'ORDER#'+ids[k]['order'],'SK':'META'}).get('status') for k in ['auto','expire']};resumed=get('WhizzMerchants_Businesses',{'businessId':ids['resume']['branch']}).get('acceptingOrders')
  if statuses=={'auto':'confirmed','expire':'expired'} and resumed:break
  time.sleep(2)
 results['statuses']=statuses;results['pauseResumed']=resumed;assert statuses=={'auto':'confirmed','expire':'expired'} and resumed,results
 auto=get('WizzOrders',{'PK':'ORDER#'+ids['auto']['order'],'SK':'META'});assert auto['estimatedPreparationTime']==20;assert auto['deliveryEstimate']['preparationMinutes']==20;assert auto['deliveryEstimate']['deliverySeconds']==180;results['preparationIncludedInEta']=True
 for kind,v in ids.items():
  event=get('staging-WalletLifecycle',{'operationId':v['operation']});assert event['status']=='DONE';assert event.get('result')=='RESUMED' if kind=='resume' else True
  if kind!='resume':assert not get('staging-Holds',{'orderId':v['order'],'sk':'HOLD'}) and not get('staging-Holds',{'orderId':v['order'],'sk':'FINANCIAL_OUTCOME'})
 results['passed']=True
finally:
 cleanup=[]
 for table,key in reversed(fixtures):
  try:db.Table(table).delete_item(Key=key,ConditionExpression='testRunId=:run',ExpressionAttributeValues={':run':run});cleanup.append({'table':table,'removed':True})
  except Exception as e:cleanup.append({'table':table,'removed':False,'code':type(e).__name__})
 results['cleanup']=cleanup;out.write_text(json.dumps(results,indent=2,default=str));print(json.dumps(results,default=str))
