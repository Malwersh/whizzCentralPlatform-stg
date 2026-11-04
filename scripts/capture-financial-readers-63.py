"""Capture only coordinated pricing readers. No handler invocation or application row reads."""
import pathlib,json,subprocess,urllib.request,hashlib,base64
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance63')
def session():
 import boto3
 c=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']))
 s=boto3.Session(aws_access_key_id=c['AccessKeyId'],aws_secret_access_key=c['SecretAccessKey'],aws_session_token=c['SessionToken'],region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';return s
HOSTS={'quote':'WizzUser-DeliveryQuotes-staging','writer':'WizzUser-CreateOrder-staging','wave':'WaveSystem_StartWave','timeout':'WaveSystem_HandleWaveTimeout','driver':'staging-driver-financial-accept'}
def main():
 OUT.mkdir(mode=0o700,exist_ok=True);assert not (OUT/'inventory.json').exists()
 import importlib.util
 spec=importlib.util.spec_from_file_location('audit',ROOT/'scripts/audit-finance-transition-staging.py');a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a);expected=a.published_versions();lam=session().client('lambda');rows={}
 for key,name in HOSTS.items():
  result=lam.get_function(FunctionName=name);cfg=result['Configuration'];assert cfg['CodeSha256']==expected[name]['codeSha256'],'LIVE_DRIFT '+key
  env=cfg.get('Environment',{}).get('Variables',{});assert env.get('FINANCIAL_DISPATCH_MODE','OFF')=='OFF' and env.get('DELIVERY_QUOTES_ENABLED','false')=='false' and env.get('COMMERCIAL_PRICING_MODE','OFF')=='OFF'
  data=urllib.request.urlopen(result['Code']['Location'],timeout=90).read();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==cfg['CodeSha256']
  (OUT/(key+'.zip')).write_bytes(data);(OUT/(key+'.config.private.json')).write_text(json.dumps(cfg));rows[key]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'handler':cfg['Handler'],'role':cfg['Role']}
 (OUT/'inventory.json').write_text(json.dumps(rows,indent=2))
 for p in OUT.iterdir():p.chmod(0o600)
 print(json.dumps({'captured':list(rows),'awsMutations':0,'activationPerformed':False}))
if __name__=='__main__':main()
