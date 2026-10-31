"""Restore missing local dependency closure; do not replace existing code, IAM or settings."""
import pathlib,zipfile,io,copy,json,re,posixpath,subprocess,sys,boto3,hashlib,base64
p=pathlib.Path('/private/tmp/merchant-settings-171');root=pathlib.Path('../whizzMerchants-stg/backend');z=zipfile.ZipFile(p/'original.zip');files={n:z.read(n) for n in z.namelist() if not n.endswith('/')};added={}
def resolve(path):
 for x in [path,path+'.js',path+'/index.js',path+'.json']:
  if x in files:return x
 return None
while True:
 missing=set()
 for f,data in list(files.items()):
  if not f.endswith('.js') or 'node_modules/' in f:continue
  for ref in re.findall(r'require\([\'\"](\.[^\'\"]+)[\'\"]\)',data.decode(errors='replace')):
   target=posixpath.normpath(posixpath.join(posixpath.dirname(f),ref))
   if not resolve(target):missing.add(target)
 if not missing:break
 for target in sorted(missing):
  dest=target+'.js';assert not dest.startswith('../')
  if target.startswith('merchant-platform/'):source=root/(target+'.js');kind='domain'
  elif target.startswith('shared/'):source=root/'functions'/(target+'.js');kind='shared'
  else:source=root/'functions/auth'/(target+'.js');kind='flattened-auth'
  assert source.is_file(),str(source);s=source.read_text()
  if kind=='flattened-auth':s=s.replace("require('../../merchant-platform/","require('./merchant-platform/").replace("require('../shared/","require('./shared/")
  files[dest]=s.encode();added[dest]=s.encode()
 assert len(added)<=20
if '--apply' not in sys.argv:
 out=io.BytesIO()
 with zipfile.ZipFile(out,'w') as dest:
  for item in z.infolist():dest.writestr(copy.copy(item),z.read(item.filename))
  for name,data in added.items():dest.writestr(name,data)
 check=zipfile.ZipFile(io.BytesIO(out.getvalue()));assert all(z.read(n)==check.read(n) for n in z.namelist());(p/'candidate.zip').write_bytes(out.getvalue());(p/'added-files.json').write_text(json.dumps(sorted(added)))
 target=p/'extracted';target.mkdir(exist_ok=True);check.extractall(target);subprocess.run(['node','-e',"const h=require(process.argv[1]);if(typeof h.handler!=='function')throw Error('missing handler');h.handler({httpMethod:'GET',headers:{},pathParameters:{businessId:'test'},path:'/businesses/test/status',queryStringParameters:{view:'order-reception'}}).then(r=>{if(r.statusCode!==401&&r.statusCode!==403)throw Error('unauthenticated request not rejected: '+r.statusCode);console.log('cold start and authentication guard passed');})",str(target/'business_online_status_handler.js')],check=True)
 print(json.dumps({'existingEntriesIdentical':True,'addedFiles':sorted(added),'newIam':False}));sys.exit()
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');c=json.loads((p/'config.private.json').read_text());before=l.get_function_configuration(FunctionName=c['FunctionName']);assert before['RevisionId']==c['RevisionId'];b=(p/'candidate.zip').read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=c['FunctionName']);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();assert after['Environment']==c['Environment'] and after['Role']==c['Role'];r=l.invoke(FunctionName=c['FunctionName'],Payload=json.dumps({'httpMethod':'GET','headers':{},'pathParameters':{'businessId':'test'},'path':'/businesses/test/status','queryStringParameters':{'view':'order-reception'}}).encode());response=json.loads(r['Payload'].read());assert response.get('statusCode') in [401,403],response
receipt={'function':c['FunctionName'],'addedFiles':json.loads((p/'added-files.json').read_text()),'existingCodeUnchanged':True,'newIam':False,'configurationUnchanged':True,'liveColdStartAndAuthCheckPassed':True,'authenticatedSettingsRead':'AWAITING_DEVICE_RETRY','codeSha256':after['CodeSha256']};pathlib.Path('docs/merchant-settings-package-repair-171.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
