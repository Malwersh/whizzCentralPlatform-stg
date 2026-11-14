"""Publish one replacement checkout scope after verified maintenance cancellation; preserve both prior pins in DRAIN.
No order, dispatch, wallet, ledger, consent or actor writes. Default is read-only.
"""
import pathlib,json,importlib.util,datetime,subprocess,sys,copy
R=pathlib.Path(__file__).resolve().parents[1]
O=pathlib.Path('/private/tmp/finance94')
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py')
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();db=s.resource('dynamodb');l=s.client('lambda')
 plan=json.loads(pathlib.Path('/private/tmp/finance91/activation-plan.private.json').read_text())
 original=plan['scope']['scopes'][0];oldid=original['orders'][0]['orderId'];driver=original['drivers'][0]['driverId']
 selector=json.loads((O/'selector.private.json').read_text());newid=selector['orderId']
 assert newid!=oldid and selector['branchId']==original['orders'][0]['branchId']
 oldorder=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oldid,'SK':'META'},ConsistentRead=True)['Item']
 assert oldorder['status']=='cancelled' and oldorder.get('maintenanceCancellation') and not oldorder.get('financialAcceptance'),'OLD_ORDER_NOT_CANCELLED'
 assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+newid,'SK':'META'},ConsistentRead=True).get('Item'),'NEW_ORDER_EXISTS'
 assert all(r['responseStatus']=='financial_expired' for r in db.Table('WaveOffers_staging').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oldid},ConsistentRead=True)['Items']),'OLD_OFFERS_REQUIRE_AUDIT'
 live=db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId':driver},ConsistentRead=True)['Item']
 assert not live.get('currentOrderId') and live.get('activeOrdersCount',0)==0
 wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver,'sk':'META'},ConsistentRead=True)['Item']
 assert wallet['lockedBalance']==0,'OLD_HOLD_REQUIRES_AUDIT'
 rows=[];old=None
 for f in plan['functions']:
  c=l.get_function_configuration(FunctionName=f['name']);cfg=json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG'])
  assert cfg==old or old is None,'SCOPE_DRIFT'
  old=cfg;assert len(cfg['scopes'])==2 and cfg['scopes'][1]['orders']==original['orders'] and cfg['scopes'][1]['drivers']==original['drivers']
  rows.append(c)
 nextcfg=copy.deepcopy(old);nextcfg['scopes'][0]['mode']='DRAIN';nextcfg['scopes'][1]['mode']='DRAIN'
 replacement=copy.deepcopy(original);replacement.update(id='fattoush-finance-replacement-94',mode='SCOPED',admitUntil=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=45)).isoformat(timespec='milliseconds').replace('+00:00','Z'))
 replacement['orders']=[{**original['orders'][0],'orderId':newid}];nextcfg['scopes'].append(replacement)
 raw=json.dumps(nextcfg,separators=(',',':'));digest=subprocess.check_output(['node','-e',"const x=JSON.parse(require('fs').readFileSync(0,'utf8')),m=require('./backend/wallet-service/dist/financeRollout'),h=require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(x);m.readFinanceRollout({AWS_REGION:'us-east-1',ENVIRONMENT:'staging',FINANCE_ROLLOUT_CONFIG:JSON.stringify(x),FINANCE_ROLLOUT_SHA256:h});console.log(h)"],input=raw.encode(),cwd=R).decode().strip()
 candidates=[]
 for c in rows:
  e={**c['Environment']['Variables'],'FINANCE_ROLLOUT_CONFIG':raw,'FINANCE_ROLLOUT_SHA256':digest}
  assert sum(len(k.encode())+len(v.encode()) for k,v in e.items())<4096,'ENVIRONMENT_SIZE_LIMIT'
  candidates.append((c,e))
 for name,value in [('before.private.json',rows),('scope.private.json',nextcfg)]:
  p=O/name;p.write_text(json.dumps(value,default=str));p.chmod(0o600)
 result={'prepared':True,'executed':False,'hosts':len(rows),'newAdmittedOrders':1,'oldScopeDraining':True,'financialWrites':False}
 if '--execute' in sys.argv:
  for c,e in candidates:
   a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['RevisionId']==c['RevisionId']
   l.update_function_configuration(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],Environment={'Variables':e})
   l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90})
   a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['CodeSha256']==c['CodeSha256'] and a['Environment']['Variables']==e
   print(json.dumps({'updated':c['FunctionName']}),flush=True)
  result['executed']=True
 (O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
