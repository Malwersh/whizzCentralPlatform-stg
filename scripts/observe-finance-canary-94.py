"""Read-only exact-order observability for the replacement canary; no order writes or simulated actors."""
import pathlib,json,importlib.util,decimal,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance94');sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def enc(x):return int(x) if isinstance(x,decimal.Decimal) and x%1==0 else float(x) if isinstance(x,decimal.Decimal) else str(x)
def main():
 db=m.session().resource('dynamodb');plan=json.loads((O/'activation-plan.private.json').read_text());scope=plan['scope']['scopes'][0];selector=scope['orders'][0];driver=scope['drivers'][0]['driverId'];order=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item');wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver,'sk':'META'},ConsistentRead=True).get('Item');result={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'orderExists':bool(order),'driverWallet':{k:wallet.get(k) for k in ['availableBalance','lockedBalance','version','status']}}
 if order:
  assert order.get('userSub')==selector['customerSubjectId'] and (order.get('storeId') or order.get('businessId'))==selector['branchId'],'ORDER_SCOPE_MISMATCH'
  p=O/'canary-order.private.json';p.write_text(json.dumps(order,default=enc,ensure_ascii=False,indent=2));p.chmod(0o600)
  result.update({k:order.get(k) for k in ['status','paymentStatus','dispatchStatus','revision','rev']});result['hasPinnedFinancialSnapshot']=bool(order.get('financialSnapshot'));result['hasCommercialSnapshot']=bool(order.get('commercialPricing'));result['hasDriverAcceptance']=bool(order.get('financialAcceptance'));result['financialSearchStatus']=order.get('financialSearch',{}).get('status');result['customerTotal']=order.get('financialSnapshot',{}).get('snapshot',{}).get('confirmedCustomerTotal')
 (O/'canary-observation.json').write_text(json.dumps(result,default=enc,indent=2));print(json.dumps(result,default=enc))
if __name__=='__main__':main()
