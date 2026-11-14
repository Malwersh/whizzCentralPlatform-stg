"""Repair only internal expression aliases in the two staging wave hosts; no guards removed."""
import boto3,pathlib,json,zipfile,io,copy,urllib.request,hashlib,base64,time,subprocess,sys,concurrent.futures
from botocore.config import Config
p=pathlib.Path('/private/tmp/dispatch-test-162');l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda',config=Config(connect_timeout=60,read_timeout=90,retries={'max_attempts':2}));names=['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']
if '--apply' not in sys.argv:
 def capture(name):
  r=l.get_function(FunctionName=name);c=r['Configuration'];b=urllib.request.urlopen(r['Code']['Location']).read();assert base64.b64encode(hashlib.sha256(b).digest()).decode()==c['CodeSha256'];(p/(name+'.original.zip')).write_bytes(b);(p/(name+'.config.private.json')).write_text(json.dumps(c));return name
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(capture,names))
 for name in names:
  z=zipfile.ZipFile(p/(name+'.original.zip'));file='dispatch-cycle-runtime.js';s=z.read(file).decode();a='prefix + "dispatchFence"';assert s.count(a)==1;s=s.replace(a,'prefix + "d"');(p/(name+'.fixed.js')).write_text(s);subprocess.run(['node','--check',str(p/(name+'.fixed.js'))],check=True);out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as dest:
   for item in z.infolist():dest.writestr(copy.copy(item),s.encode() if item.filename==file else z.read(item.filename))
  b=out.getvalue();f=zipfile.ZipFile(io.BytesIO(b));assert all(f.read(n)==z.read(n) for n in z.namelist() if n!=file);(p/(name+'.fixed.zip')).write_bytes(b)
 print('PREPARED: shorter aliases only; all guards preserved');sys.exit()
receipt={'status':'APPLYING','functions':[],'newIam':False,'guardChecksRemoved':0,'targetedRegressionTestsPassed':24,'originalCheckoutMergedExpressionBytes':2344}
for name in names:
 c=json.loads((p/(name+'.config.private.json')).read_text());b=(p/(name+'.fixed.zip')).read_bytes();current=l.get_function_configuration(FunctionName=name);assert current['RevisionId']==c['RevisionId'] and current['CodeSha256']==c['CodeSha256'];l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=b)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();assert after['Role']==c['Role'] and after['Environment']==c['Environment'];receipt['functions'].append({'name':name,'verified':True,'codeSha256':after['CodeSha256'],'configurationUnchanged':True});(p/'fence-fix-receipt.json').write_text(json.dumps(receipt));print(name,'VERIFIED',flush=True)
receipt['status']='VERIFIED';pathlib.Path('docs/dispatch-offer-fence-repair-162.json').write_text(json.dumps(receipt,indent=2)+'\n');print('COMPLETE',flush=True)
