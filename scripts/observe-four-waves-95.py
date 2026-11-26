"""Read-only observation of the user-created replacement canary; no dispatch invocation."""
import pathlib,json,importlib.util,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance95');O.mkdir(exist_ok=True,mode=0o700)
spec=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def main():
 db=m.session().resource('dynamodb');selector=json.loads(pathlib.Path('/private/tmp/finance94/selector.private.json').read_text());oid=selector['orderId']
 rows=db.Table('WizzDispatchJobs_staging').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True)['Items'];offers=db.Table('WaveOffers_staging').query(KeyConditionExpression='orderId=:o',ExpressionAttributeValues={':o':oid},ConsistentRead=True)['Items'];order=db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+oid,'SK':'META'},ConsistentRead=True)['Item'];job=next(r for r in rows if r['SK']=='METADATA')
 result={'checkedAtUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True,'orderStatus':order['status'],'hasAcceptance':bool(order.get('financialAcceptance')),'currentWave':int(job['currentWaveNumber']),'jobStatus':job['status'],'waves':[{'number':int(r['SK'].split('#')[1]),'state':r['state'],'recipients':len(r['driverIds']),'delivered':len(r['delivered']),'createdAt':r['createdAt']} for r in rows if r['SK'].startswith('FINANCIAL_WAVE#')],'offers':[{'wave':int(r['financialOffer']['assignmentVersion']),'status':r['responseStatus'],'expiresAt':r['expiresAt']} for r in offers]}
 p=O/'latest.json';p.write_text(json.dumps(result,indent=2));print(json.dumps(result))
 raw=O/'rows.private.json';raw.write_text(json.dumps({'rows':rows,'offers':offers},default=str));raw.chmod(0o600)
if __name__=='__main__':main()
