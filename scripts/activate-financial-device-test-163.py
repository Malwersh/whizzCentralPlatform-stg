"""Prepare/activate one fresh test after explicit cancellation, retaining all historical scope pins."""
import boto3,pathlib,json,datetime,copy,subprocess,hashlib,time,sys,concurrent.futures,os
from botocore.config import Config
R=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/financial-device-test-163');s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=25,retries={'max_attempts':2});l=s.client('lambda',config=cfg);d=s.resource('dynamodb',config=cfg)
assert s.client('sts',config=cfg).get_caller_identity()['Account']=='699561669180'
old=json.load(open('/private/tmp/financial-device-test-161/selector.private.json'));order=d.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+old['orderId'],'SK':'META'},ConsistentRead=True)['Item'];assert order['status']=='cancelled' and order['maintenanceCancellation']['noAssignmentOrFunds'] is True
new=json.loads((p/'selector.private.json').read_text());assert not d.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+new['orderId'],'SK':'META'},ConsistentRead=True).get('Item')
names=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"],cwd=R))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:configs=list(pool.map(lambda n:l.get_function_configuration(FunctionName=n),names))
scopes=[json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']) for c in configs];assert all(x==scopes[0] for x in scopes)
# Retire only the completed test cohort; keep both historical financial drain pins untouched.
retired=next(x for x in scopes[0]['scopes'] if x['id']=='fattoush-financial-host-157');audit=[]
for selected in retired['orders']:
 oid=selected['orderId'];saved=d.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True)['Item'];assert saved['status']=='cancelled' and saved['maintenanceCancellation']['noAssignmentOrFunds'] is True
 for table in ['staging-Holds','WaveOffers_staging']:
  result=d.Table(table).query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True);assert not result.get('Items') and not result.get('LastEvaluatedKey')
 jobs=d.Table('WizzDispatchJobs_staging').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True);assert not jobs.get('LastEvaluatedKey');assert all((r['status']=='cancelled' if r['SK']=='METADATA' else r.get('state') in ['APPLIED','CANCELLED']) for r in jobs['Items']);audit.append({'orderId':oid,'cancelled':True,'noOffersOrHolds':True,'allDispatchRowsClosed':True})
(p/'retired-scope-audit.private.json').write_text(json.dumps({'scope':retired,'audit':audit}));os.chmod(p/'retired-scope-audit.private.json',0o600)

if '--apply' not in sys.argv:
 current=copy.deepcopy(scopes[0]);previous=next(x for x in current['scopes'] if x['id']=='fattoush-financial-host-157');fresh=copy.deepcopy(previous);fresh.update(id='fattoush-financial-host-163',admitUntil=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=90)).isoformat(timespec='milliseconds').replace('+00:00','Z'),orders=[{'orderId':new['orderId'],'branchId':new['branchId'],'customerSubjectId':previous['orders'][0]['customerSubjectId']}]);current['scopes']=[fresh if x['id']=='fattoush-financial-host-157' else x for x in current['scopes']]
 digest=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8')))))"],cwd=R,input=json.dumps(current).encode()))
 changes={'FINANCE_ROLLOUT_CONFIG':json.dumps(current,separators=(',',':')),'FINANCE_ROLLOUT_SHA256':digest}
 for c in configs:assert len(json.dumps({**c['Environment']['Variables'],**changes},separators=(',',':'),ensure_ascii=False).encode())<4096,c['FunctionName']
 candidate={'scope':current,'changes':changes,'configs':configs};(p/'activation.private.json').write_text(json.dumps(candidate));os.chmod(p/'activation.private.json',0o600);print('PREPARED',len(configs),'hosts; historical scopes unchanged');sys.exit()
a=json.loads((p/'activation.private.json').read_text());
for original in scopes[0]['scopes']:
 
 if original['id']=='fattoush-financial-host-157':assert any(x['id']=='fattoush-financial-host-163' for x in a['scope']['scopes'])
 else:assert original in a['scope']['scopes']
assert not (p/'activation-receipt.private.json').exists()
for c in configs:
 before=next(x for x in a['configs'] if x['FunctionName']==c['FunctionName']);assert before['RevisionId']==c['RevisionId'] and before['CodeSha256']==c['CodeSha256']
proof={'status':'APPLYING','functions':[],'scopeId':'fattoush-financial-host-163','admitUntil':a['scope']['scopes'][-1]['admitUntil']};receipt=p/'activation-receipt.private.json'
ordered=sorted(configs,key=lambda c:c['FunctionName'] in ['WizzUser-CreateOrder-staging','WizzUser-DeliveryQuotes-staging'])
for c in ordered:
 n=c['FunctionName'];env={**c['Environment']['Variables'],**a['changes']};receipt.write_text(json.dumps(proof));os.chmod(receipt,0o600);l.update_function_configuration(FunctionName=n,RevisionId=c['RevisionId'],Environment={'Variables':env})
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=n)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==c['CodeSha256'] and after['Environment']['Variables']==env
 proof['functions'].append({'name':n,'verified':True});receipt.write_text(json.dumps(proof));print(n,'VERIFIED',flush=True)
proof['status']='ACTIVE_ONE_NEW_ORDER';receipt.write_text(json.dumps(proof));print('ACTIVATED',flush=True)
