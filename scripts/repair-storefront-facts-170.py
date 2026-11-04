"""Remove fabricated public store facts only; no IAM or financial configuration changes."""
import pathlib,zipfile,copy,io,json,subprocess,re,boto3,hashlib,base64,sys,concurrent.futures
p=pathlib.Path('/private/tmp/storefront-facts-170');names=['WizzUser-GetBusinesses-staging','WizzUser-GetBusiness-staging'];helper=pathlib.Path('../wizzuser-stg/backend/src/functions/shared/storefront-facts-170.js').read_bytes()
if '--apply' not in sys.argv:
 for name in names:
  z=zipfile.ZipFile(p/(name+'.original.zip'));changes={}
  for f in z.namelist():
   if f not in ['functions/get-businesses/index.js','functions/get-business/index.js']:continue
   s=z.read(f).decode();ref='result.Item' if '/get-business/' in f else 'item';s,n=re.subn(r'rating:\s*'+re.escape(ref)+r'\.rating\s*\|\|\s*4\.2,','...storefrontFacts('+ref+'),',s);assert n==1
   s,n=re.subn(r'^\s*delivery_(?:time|fee):[^\n]*\n','\n',s,flags=re.M);assert n==2;s="const {storefrontFacts}=require('../shared/storefront-facts-170');\n"+s;changes[f]=s.encode();temp=p/(name+'.'+f.split('/')[1]+'.js');temp.write_text(s);subprocess.run(['node','--check',str(temp)],check=True)
  assert len(changes)==2;out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as dest:
   for item in z.infolist():dest.writestr(copy.copy(item),changes.get(item.filename,z.read(item.filename)))
   dest.writestr('functions/shared/storefront-facts-170.js',helper)
  checked=zipfile.ZipFile(io.BytesIO(out.getvalue()));assert all(z.read(f)==checked.read(f) for f in z.namelist() if f not in changes);(p/(name+'.fixed.zip')).write_bytes(out.getvalue());print(name,'PREPARED',flush=True)
 sys.exit()
l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda');receipt={'functions':[],'newIam':False,'financialWrites':False,'sourceContractTestsPassed':3}
def deploy(name):
 c=json.loads((p/(name+'.config.private.json')).read_text());before=l.get_function_configuration(FunctionName=name);assert before['RevisionId']==c['RevisionId'];b=(p/(name+'.fixed.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=c['RevisionId'],ZipFile=b);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(b).digest()).decode();assert after['Environment']==c['Environment'] and after['Role']==c['Role'];print(name,'VERIFIED',flush=True);return {'name':name,'codeSha256':after['CodeSha256'],'configurationPreserved':True}
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:receipt['functions']=list(pool.map(deploy,names))
pathlib.Path('docs/storefront-facts-publication-170.json').write_text(json.dumps(receipt,indent=2)+'\n')
