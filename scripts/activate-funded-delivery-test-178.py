"""Activate one prepared unused customer order, consumers first and Creator last.
Preserve historical cohort membership, IAM, code, all other settings and balances.
"""
import pathlib,json,datetime,concurrent.futures,subprocess,boto3,os,zipfile,hashlib,base64
from botocore.config import Config
p=pathlib.Path('/private/tmp/funded-delivery-178');plan=json.loads((p/'scope-draft.private.json').read_text());selector=json.loads((p/'selector.private.json').read_text());policy=json.loads((p/'policy.private.json').read_text())['current'];now=datetime.datetime.now(datetime.timezone.utc);assert datetime.datetime.fromisoformat(policy['policy']['effectiveFrom'].replace('Z','+00:00'))<=now<datetime.datetime.fromisoformat(policy['policy']['effectiveTo'].replace('Z','+00:00'))
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');cfg=Config(connect_timeout=8,read_timeout=60,retries={'max_attempts':2});l=s.client('lambda',config=cfg);d=s.resource('dynamodb',config=cfg)
assert s.client('sts',config=cfg).get_caller_identity()['Account']=='699561669180'
assert not d.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item'),'NEW_ORDER_ALREADY_EXISTS'
w=d.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#34d8e408-1021-7076-6055-7325644f97cb','sk':'META'},ConsistentRead=True)['Item'];assert w['lockedBalance']==0 and w['availableBalance']>=25000
activation=p/'activation.private.json';receipt=p/'activation-receipt.private.json'
if not activation.exists():
 plan['scope']['scopes'][-1]['admitUntil']=min(now+datetime.timedelta(minutes=90),datetime.datetime.fromisoformat(policy['policy']['effectiveTo'].replace('Z','+00:00'))).isoformat(timespec='milliseconds').replace('+00:00','Z');assert plan['scope']['scopes'][-1]['id']=='fattoush-funded-178'
 digest=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8')))))"],input=json.dumps(plan['scope']).encode()));plan['changes']={'FINANCE_ROLLOUT_CONFIG':json.dumps(plan['scope'],separators=(',',':')),'FINANCE_ROLLOUT_SHA256':digest}
 activation.write_text(json.dumps(plan));activation.chmod(0o600)
a=json.loads(activation.read_text());names=[c['FunctionName']for c in a['configs']]
# Verified against the actual installed package, not an assumed local handler.
removed={'order-receiver-merchant-orders-staging-v1':['BUSINESS_PHOTOS_BUCKET','SNS_APNS_ARN','SNS_FCM_ARN']}
archive=(p/'merchant-host.zip').read_bytes();audited=json.loads((p/'merchant-host-before.private.json').read_text());assert base64.b64encode(hashlib.sha256(archive).digest()).decode()==audited['CodeSha256']
with zipfile.ZipFile(p/'merchant-host.zip')as z:
 sources=b'\n'.join(z.read(n)for n in z.namelist()if n.endswith(('.js','.cjs','.mjs','.json'))and'node_modules/'not in n)
 for key in removed['order-receiver-merchant-orders-staging-v1']:assert key.encode()not in sources,'ENV_KEY_IS_REFERENCED: '+key
assert next(c for c in a['configs']if c['FunctionName']=='order-receiver-merchant-orders-staging-v1')['CodeSha256']==audited['CodeSha256']
def environment(c):return {k:v for k,v in {**c['Environment']['Variables'],**a['changes']}.items()if k not in removed.get(c['FunctionName'],[])}

with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:current=list(pool.map(lambda n:l.get_function_configuration(FunctionName=n),names))
proof=json.loads(receipt.read_text())if receipt.exists()else {'status':'APPLYING','functions':[],'scopeId':'fattoush-funded-178','admitUntil':a['scope']['scopes'][-1]['admitUntil'],'orderId':selector['orderId'],'policyId':policy['id']}
for c in current:
 before=next(x for x in a['configs']if x['FunctionName']==c['FunctionName']);env=environment(before);assert len(json.dumps(env,separators=(',',':'),ensure_ascii=False).encode())<4096
 assert c['CodeSha256']==before['CodeSha256']and c['Role']==before['Role'],'CODE_OR_ROLE_DRIFT'
 if c['Environment']['Variables']!=env:assert c['RevisionId']==before['RevisionId']and c['Environment']==before['Environment'],'ENVIRONMENT_DRIFT'
subprocess.run(['node','-e',"const r=JSON.parse(require('fs').readFileSync(0,'utf8')),c=require('./scripts/check-finance-rollout-deployment.cjs');for(const f of r.configs)c.preserveDrainingScopes({AWS_REGION:'us-east-1',...f.Environment.Variables},{AWS_REGION:'us-east-1',...f.Environment.Variables,...r.changes});"],input=json.dumps(a).encode(),check=True)
# Management being enabled does not itself imply that every financial host is ready.
required={'WizzUser-CreateOrder-staging':{'DELIVERY_PROMOTION_MODE':'REQUIRED'},'WaveSystem_CreateDispatchJob':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},'WaveSystem_StartWave':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},'WaveSystem_HandleWaveTimeout':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},'staging-driver-financial-accept':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},'staging-cod-integration':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'},'order-receiver-merchant-orders-staging-v1':{'FINANCIAL_DELIVERY_FUNDING_MODE':'REQUIRED'}}
for c in current:
 for key,value in required.get(c['FunctionName'],{}).items():assert c['Environment']['Variables'].get(key)==value,'HOST_CAPABILITY_NOT_ENABLED: '+c['FunctionName']+' '+key
ordered=sorted(current,key=lambda c:2 if c['FunctionName']=='WizzUser-CreateOrder-staging'else 1 if c['FunctionName']=='WizzUser-DeliveryQuotes-staging'else 0)
for c in ordered:
 n=c['FunctionName'];env=environment(c);receipt.write_text(json.dumps(proof));receipt.chmod(0o600)
 if c['Environment']['Variables']!=env:
  l.update_function_configuration(FunctionName=n,RevisionId=c['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=n,WaiterConfig={'Delay':2,'MaxAttempts':90})
 after=l.get_function_configuration(FunctionName=n);assert after['LastUpdateStatus']=='Successful'and after['Environment']['Variables']==env
 for key in ['CodeSha256','Role','Handler','Runtime','Timeout','MemorySize','Architectures','Layers','VpcConfig']:assert c.get(key)==after.get(key),key
 if not any(x['name']==n for x in proof['functions']):proof['functions'].append({'name':n,'verified':True})
 receipt.write_text(json.dumps(proof));print(n,'VERIFIED',flush=True)
proof['status']='ACTIVE_ONE_NEW_FUNDED_ORDER';receipt.write_text(json.dumps(proof));assert not d.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item')
public={**proof,'hostsVerified':len(proof['functions']),'historicalScopeMembershipsPreserved':True,'previousDeliveredScopeDraining':True,'codeAndIamPreserved':True,'changedEnvironmentKeys':list(a['changes']),'unusedEnvironmentKeysRemoved':removed,'environmentKeyAuditCodeSha256':audited['CodeSha256'],'walletWrites':0,'orderCreated':False};pathlib.Path('docs/funded-delivery-activation-178.json').write_text(json.dumps(public,indent=2)+'\n');print('ACTIVATED one unused funded test order',flush=True)
