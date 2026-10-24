import boto3,urllib.request,json,hashlib,base64,zipfile,os
from pathlib import Path
out=Path('/private/tmp/dispatch50-live');assert not out.exists();out.mkdir(mode=0o700)
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda')
names=['staging-wizz-staff-service','WizzUser-DeliveryQuotes-staging','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept','staging-account-deletion-requests','staging-account-deletion-worker','staging-account-deletion-financial-expiry','staging-cod-integration']
inv={'account':'699561669180','region':'us-east-1','functions':[]}
for name in names:
 r=lam.get_function(FunctionName=name);c=r['Configuration'];assert c['FunctionArn']==f'arn:aws:lambda:us-east-1:699561669180:function:{name}';env=c.get('Environment',{}).get('Variables',{})
 assert env.get('STAGE','staging')=='staging';u=r['Code']['Location'];assert urllib.parse.urlparse(u).hostname.endswith('.amazonaws.com')
 data=urllib.request.urlopen(u,timeout=90).read();assert base64.b64encode(hashlib.sha256(data).digest()).decode()==c['CodeSha256'];p=out/(name+'.zip');p.write_bytes(data);p.chmod(0o600)
 with zipfile.ZipFile(p) as z:
  for n in z.namelist():
   if n.endswith('.js') and 'node_modules/' not in n:
    assert not n.startswith('/') and '..' not in n.split('/') and '\\' not in n
    dest=out/'source'/name/n;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(z.read(n));dest.chmod(0o600)
 inv['functions'].append({'name':name,'handler':c['Handler'],'runtime':c['Runtime'],'role':c['Role'],'timeout':c['Timeout'],'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'environmentDigest':hashlib.sha256(json.dumps(env,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest(),'gates':{k:v for k,v in env.items() if k.endswith('_MODE') and k.startswith(('DISPATCH_','FINANCIAL_','DELIVERY_','PINNED_'))}})
 (out/'inventory.json').write_text(json.dumps(inv,indent=2)+'\n');(out/'inventory.json').chmod(0o600)
 print(json.dumps({'downloaded':name}),flush=True)
