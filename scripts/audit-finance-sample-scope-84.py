"""Read-only coordinated-host scope audit; no enrollment, financial activation, or account writes."""
import pathlib,json,importlib.util,datetime,subprocess
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance84');O.mkdir(exist_ok=True,mode=0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 l=m.session().client('lambda');names=json.loads(subprocess.check_output(['node','-e',"console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"],cwd=R));manifest={'account':'699561669180','region':'us-east-1','functions':[]};rows=[];now=datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00','Z')
 for name in names:
  c=l.get_function_configuration(FunctionName=name);e=c.get('Environment',{}).get('Variables',{});scope=json.loads(e['FINANCE_ROLLOUT_CONFIG']) if e.get('FINANCE_ROLLOUT_CONFIG') else None
  selected={k:v for k,v in e.items() if k in ['STAGE','ENVIRONMENT','FINANCE_ROLLOUT_CONFIG','FINANCE_ROLLOUT_SHA256']};selected['AWS_REGION']='us-east-1';manifest['functions'].append({'name':name,'arn':c['FunctionArn'],'env':selected})
  gates={k:v for k,v in e.items() if k in ['DELIVERY_QUOTES_ENABLED','DELIVERY_QUOTE_MODE','COMMERCIAL_PRICING_MODE'] or k.startswith('FINANCIAL_') and k.endswith('_MODE')}
  rows.append({'name':name,'codeSha256':c['CodeSha256'],'scopeConfigured':scope is not None,'scopeCount':len((scope or {}).get('scopes',[])),'openAdmissions':sum(x.get('mode')=='SCOPED' and x.get('admitUntil','')>now for x in (scope or {}).get('scopes',[])),'gates':gates})
 p=O/'scope-manifest.private.json';p.write_text(json.dumps(manifest,indent=2));p.chmod(0o600)
 check=subprocess.run(['node','scripts/check-finance-rollout-deployment.cjs',str(p)],cwd=R,capture_output=True,text=True)
 result={'part':84,'checkedAtUtc':now,'readOnly':True,'functions':rows,'coordinatedScopeReady':check.returncode==0,'scopeCheck':json.loads(check.stdout) if check.returncode==0 else check.stderr.strip(),'noOpenAdmissions':all(x['openAdmissions']==0 for x in rows),'activationPerformed':False};(O/'scope-audit.json').write_text(json.dumps(result,indent=2));print(json.dumps({'functions':len(rows),'coordinatedScopeReady':result['coordinatedScopeReady'],'scopeCheck':result['scopeCheck'],'noOpenAdmissions':result['noOpenAdmissions'],'activationPerformed':False}))
if __name__=='__main__':main()
