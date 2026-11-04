"""Read only: verify the exact delivered canary's integration and stable settlement."""
import pathlib,json,importlib.util,datetime
R=pathlib.Path(__file__).resolve().parents[1]
s=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def main():
 session=m.session();db=session.resource('dynamodb');oid=json.loads(pathlib.Path('/private/tmp/finance94/selector.private.json').read_text())['orderId']
 events={}
 for name in ['acceptance','completion']:
  old=json.loads(pathlib.Path('/private/tmp/finance96/'+name+'-event.private.json').read_text());assert old['orderId']==oid
  row=db.Table('staging-WalletLifecycle').get_item(Key={'operationId':old['operationId']},ConsistentRead=True)['Item']
  events[name]={k:row.get(k) for k in ['status','integrationAttempts','integrationError','nextAttemptAt','integratedAt','metricsResult']}
 order=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True)['Item']
 wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+order['driverId'],'sk':'META'},ConsistentRead=True)['Item']
 metrics=db.Table('WizzDriverPerformanceMetrics_staging').get_item(Key={'PK':'DRIVER#'+order['driverId'],'SK':'METRICS'},ConsistentRead=True).get('Item',{})
 outcome=db.Table('staging-Holds').get_item(Key={'orderId':oid,'sk':'FINANCIAL_OUTCOME'},ConsistentRead=True)['Item']
 assert order['status']=='delivered' and order['paymentStatus']=='captured' and outcome['kind']=='COD_COMPLETION_JOURNAL'
 assert sum(x['delta'] for x in outcome['journalLines'])==0
 baseline=json.loads(pathlib.Path('/private/tmp/finance96/audit.private.json').read_text())
 from decimal import Decimal
 stable={}
 for wid,before in baseline['wallets'].items():
  after=db.Table('staging-Wallets').get_item(Key={'walletId':wid,'sk':'META'},ConsistentRead=True)['Item']
  assert all(Decimal(str(after[k]))==Decimal(str(before[k])) for k in ['availableBalance','lockedBalance','version'])
  rows=[];cursor=None
  while True:
   q={'KeyConditionExpression':'walletId=:w','ExpressionAttributeValues':{':w':wid,':o':oid},'FilterExpression':'relatedEntityId=:o OR metadata.orderId=:o','ConsistentRead':True,'Limit':200}
   if cursor:q['ExclusiveStartKey']=cursor
   page=db.Table('staging-LedgerEntries').query(**q);rows+=page.get('Items',[]);cursor=page.get('LastEvaluatedKey')
   if not cursor:break
  signature=lambda rs: sorted((r['sk'],Decimal(str(r['amount']))) for r in rs)
  assert signature(rows)==signature(baseline['ledger'][wid])
  stable[wid.split('#')[1]]=True
 result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'events':events,'orderStatus':order['status'],'paymentStatus':order['paymentStatus'],'wallet':{k:wallet.get(k) for k in ['availableBalance','lockedBalance','version']},'metrics':{k:metrics.get(k) for k in ['financialAcceptedCount','financialCompletedCount','completionRateStatus']},'journalBalanced':True,'walletsAndLedgerUnchanged':stable}
 p=pathlib.Path('/private/tmp/finance97/latest.json');p.write_text(json.dumps(result,default=str,indent=2));print(json.dumps(result,default=str))
if __name__=='__main__':main()
