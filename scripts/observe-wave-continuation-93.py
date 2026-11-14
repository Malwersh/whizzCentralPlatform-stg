"""Observe only the replacement canary and recent timeout errors; no worker invocation."""
import pathlib,json,datetime,importlib.util
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance93')
spec=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def main():
 s=m.session();db=s.resource('dynamodb');oid=json.loads(pathlib.Path('/private/tmp/finance91/selector.private.json').read_text())['orderId']
 rows=db.Table('WizzDispatchJobs_staging').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True)['Items']
 order=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True).get('Item',{})
 c=s.client('lambda').get_function_configuration(FunctionName='WaveSystem_HandleWaveTimeout')
 result={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'financialTimeoutGate':c['Environment']['Variables'].get('FINANCIAL_DISPATCH_MODE'),'orderStatus':order.get('status'),'dispatchStatus':order.get('dispatchStatus'),'financialSearch':order.get('financialSearch'),'hasFinancialAcceptance':bool(order.get('financialAcceptance')),'rows':[{k:r.get(k) for k in ['SK','status','state','currentWaveNumber','noDriverReason']} for r in rows],'readOnly':True}
 p=O/'observation.json';p.write_text(json.dumps(result,default=str,indent=2));print(json.dumps(result,default=str))
 start=int((O/'publication.json').stat().st_mtime*1000)-1000 if (O/'publication.json').exists() else int((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=2)).timestamp()*1000)
 logs=s.client('logs').filter_log_events(logGroupName='/aws/lambda/WaveSystem_HandleWaveTimeout',startTime=start,filterPattern='?ERROR ?"Timeout processing complete"',limit=30)
 p=O/'post-publication-logs.private.json';p.write_text(json.dumps(logs,default=str));p.chmod(0o600)
 for e in logs.get('events',[]): print(e['message'][:1800])
if __name__=='__main__':main()
