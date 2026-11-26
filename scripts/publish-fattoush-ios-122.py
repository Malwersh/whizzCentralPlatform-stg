"""Apply the prepared single-order rollout configuration, retaining all other settings."""
import pathlib,importlib.util,json,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance122')
def main():
 sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();lam=s.client('lambda');rows=json.loads((O/'before.private.json').read_text());manifest=json.loads((O/'manifest.private.json').read_text());assert len(rows)==15 and not (O/'publication.json').exists()
 sp=importlib.util.spec_from_file_location('a',R/'scripts/audit-finance-transition-staging.py');a=importlib.util.module_from_spec(sp);sp.loader.exec_module(a);expected=a.published_versions()
 for c in rows:
  now=lam.get_function_configuration(FunctionName=c['FunctionName']);assert now['RevisionId']==c['RevisionId'],'LIVE_DRIFT';assert c['CodeSha256']==expected[c['FunctionName']]['codeSha256'],'UNRECORDED_CODE'
 selector=json.loads((O/'selector.private.json').read_text());db=s.resource('dynamodb');assert not db.Table('WizzOrders').get_item(Key={'PK':'ORDER#'+selector['orderId'],'SK':'META'},ConsistentRead=True).get('Item')
 results=[]
 for c,f in zip(rows,manifest['functions']):
  env={k:v for k,v in f['env'].items() if k!='AWS_REGION'};assert set(k for k in env if env[k]!=c['Environment']['Variables'].get(k))<= {'FINANCE_ROLLOUT_CONFIG','FINANCE_ROLLOUT_SHA256'}
  lam.update_function_configuration(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],Environment={'Variables':env});lam.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':45});after=lam.get_function_configuration(FunctionName=c['FunctionName']);assert after['Environment']['Variables']==env and after['CodeSha256']==c['CodeSha256'];results.append({'name':c['FunctionName'],'codeSha256':after['CodeSha256'],'revisionId':after['RevisionId']});(O/'publication.json').write_text(json.dumps({'functions':results,'completed':len(results)==15},indent=2));print(json.dumps({'configured':c['FunctionName']}),flush=True)
 print(json.dumps({'complete':True,'applicationWrites':False,'newOrdersAllowed':1}))
if __name__=='__main__':main()
