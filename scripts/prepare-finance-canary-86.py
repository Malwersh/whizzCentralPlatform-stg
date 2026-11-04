"""Capture current configuration and prepare a bounded canary. No AWS writes."""
import pathlib,json,importlib.util,subprocess,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance86');O.mkdir(exist_ok=True,mode=0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 subprocess.run(['node','scripts/prepare-finance-sample-85.cjs'],cwd=R,check=True,capture_output=True)
 candidate=json.loads(pathlib.Path('/private/tmp/finance85/scope-candidate.private.json').read_text());l=m.session().client('lambda');changes={
 'WizzUser-DeliveryQuotes-staging':{'DELIVERY_QUOTES_ENABLED':'true'},
 'WizzUser-CreateOrder-staging':{'DELIVERY_QUOTE_MODE':'REQUIRED','COMMERCIAL_PRICING_MODE':'REQUIRED'},
 'WaveSystem_StartWave':{'FINANCIAL_DISPATCH_MODE':'REQUIRED'},
 'WaveSystem_HandleWaveTimeout':{'FINANCIAL_DISPATCH_MODE':'REQUIRED'},
 'DriversApi-staging':{'FINANCIAL_ACCEPT_FUNCTION_ARN':'arn:aws:lambda:us-east-1:699561669180:function:staging-driver-financial-accept','FINANCIAL_DISPATCH_MODE':'REQUIRED','FINANCIAL_COD_COMPLETION_MODE':'REQUIRED','FINANCIAL_COD_ASSIGNMENTS_MODE':'REQUIRED','FINANCIAL_COD_RETURNS_MODE':'REQUIRED'},
 'staging-driver-financial-accept':{'FINANCIAL_DISPATCH_MODE':'REQUIRED','FINANCIAL_COD_COMPLETION_MODE':'REQUIRED','FINANCIAL_COD_ASSIGNMENTS_MODE':'REQUIRED','FINANCIAL_COD_RETURNS_MODE':'REQUIRED'},
 'staging-cod-integration':{'FINANCIAL_COD_INTEGRATION_MODE':'REQUIRED','DISPATCH_RESPONSE_INTEGRATION_MODE':'REQUIRED'},
 'staging-wizz-wallet-notification-worker':{'FINANCIAL_COD_NOTIFICATIONS_MODE':'REQUIRED'}}
 # Scope is present before any gate opens, including internal settlement readers.
 source=candidate['functions'][0]['env'];scoped={k:source[k] for k in ['FINANCE_ROLLOUT_CONFIG','FINANCE_ROLLOUT_SHA256']};scope=json.loads(scoped['FINANCE_ROLLOUT_CONFIG']);scope['scopes'][0]['orders']=scope['scopes'][0]['orders'][:1];scope['scopes'][0]['admitUntil']=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=45)).isoformat(timespec='milliseconds').replace('+00:00','Z')
 node="console.log(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8'))))";scoped={'FINANCE_ROLLOUT_CONFIG':json.dumps(scope,separators=(',',':')),'FINANCE_ROLLOUT_SHA256':subprocess.check_output(['node','-e',node],input=json.dumps(scope).encode(),cwd=R).decode().strip()}
 names=[f['name'] for f in candidate['functions']]+['staging-cod-integration'] if not any(f['name']=='staging-cod-integration' for f in candidate['functions']) else [f['name'] for f in candidate['functions']]
 rows=[]
 for name in names:
  cfg=l.get_function_configuration(FunctionName=name);e=cfg.get('Environment',{}).get('Variables',{});assert not e.get('FINANCE_ROLLOUT_CONFIG'),'EXISTING_SCOPE_REQUIRES_DRAIN_AUDIT'
  assert (e.get('STAGE',e.get('ENVIRONMENT'))=='staging' or not e.get('STAGE') and not e.get('ENVIRONMENT') and 'staging' in name.lower()) and all(v in ['OFF','false'] for k,v in e.items() if k in ['DELIVERY_QUOTE_MODE','COMMERCIAL_PRICING_MODE','FINANCIAL_DISPATCH_MODE','FINANCIAL_COD_COMPLETION_MODE','FINANCIAL_COD_ASSIGNMENTS_MODE','FINANCIAL_COD_RETURNS_MODE','FINANCIAL_COD_INTEGRATION_MODE','FINANCIAL_COD_NOTIFICATIONS_MODE'])
  p=O/(name+'.before.private.json');p.write_text(json.dumps(cfg,default=str));p.chmod(0o600)
  rows.append({'name':name,'revisionId':cfg['RevisionId'],'codeSha256':cfg['CodeSha256'],'scopeChanges':{**scoped,**({'ENVIRONMENT':'staging'} if not e.get('STAGE') and not e.get('ENVIRONMENT') else {})},'gateChanges':changes.get(name,{})})
 plan={'account':'699561669180','region':'us-east-1','functions':rows,'scope':scope,'admitUntil':scope['scopes'][0]['admitUntil'],'orderCount':1,'driverCount':1,'customerCount':1,'branchCount':1,'applicationWrites':False,'executed':False};p=O/'activation-plan.private.json';p.write_text(json.dumps(plan,indent=2));p.chmod(0o600);print(json.dumps({'prepared':True,'hosts':len(rows),'orders':1,'admissionMinutes':45,'configurationWrites':0,'financialActivation':False}))
if __name__=='__main__':main()
