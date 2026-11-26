import sys,pathlib,json,zipfile,hashlib,base64,urllib.request,time,io
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/cash-adjudication-278-read')
for name in ['wallet-all','staff-all','read-bundle-tests','ledger-bundle-tests']:assert 'fail 0' in pathlib.Path('/private/tmp/cash-adjudication-278-'+name+'.log').read_text(),name
s=session();assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');packages=json.loads((p/'packages.json').read_text());doc=r/'docs/cash-adjudication-read-publication-278.json';record={'part':278,'status':'PREPARED','scope':'staging','purpose':'Prove administrative cash settlement in merchant accrual/payout readers and wallet statements','functions':packages,'iamOrConfigurationChanged':False,'existingFinancialOrOrderRecordsModified':False}
def save():doc.write_text(json.dumps(record,indent=2)+'\n')
for f in packages:assert l.get_function_configuration(FunctionName=f['function'])['CodeSha256']==f['baseCodeSha256'],f['function']
record['status']='PUBLISHING';save()
for f in packages:
 payload=(p/(f['label']+'-candidate.zip')).read_bytes();assert hashlib.sha256(payload).hexdigest()==f['packageSha256'];cfg=l.get_function_configuration(FunctionName=f['function']);assert cfg['CodeSha256']==f['baseCodeSha256'];expected=base64.b64encode(hashlib.sha256(payload).digest()).decode()
 l.update_function_code(FunctionName=f['function'],RevisionId=cfg['RevisionId'],ZipFile=payload,Publish=False)
 for _ in range(75):
  after=l.get_function_configuration(FunctionName=f['function'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful' and after['CodeSha256']==expected
 for key in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert cfg.get(key)==after.get(key),(f['label'],key)
 f['deployedCodeSha256']=expected;save();print('Updated proof reader '+f['label'],flush=True)
for f in packages:
 live=l.get_function(FunctionName=f['function']);assert live['Configuration']['CodeSha256']==f['deployedCodeSha256'];actual=zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(live['Code']['Location'],timeout=90).read()));candidate=zipfile.ZipFile(p/(f['label']+'-candidate.zip'));original=zipfile.ZipFile(p/(f['label']+'-base.zip'));assert sorted(actual.namelist())==sorted(candidate.namelist())
 for n in actual.namelist():
  assert actual.read(n)==candidate.read(n),(f['label'],n)
  if n not in f['changedFiles']:assert actual.read(n)==original.read(n),(f['label'],n)
 f['allDeployedBytesVerified']=True;save()
record['status']='PUBLISHED_VERIFIED';save();print('PASS merchant and wallet reading compatibility; exact bytes and unchanged configurations verified.',flush=True)
