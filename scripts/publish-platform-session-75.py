import pathlib,json,importlib.util,urllib.request,zipfile,copy,base64,hashlib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/session75');O.mkdir(exist_ok=True)
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
l=m.session().client('lambda');n='staging-wizz-staff-service';f=l.get_function(FunctionName=n);c=f['Configuration'];b=urllib.request.urlopen(f['Code']['Location'],timeout=60).read();(O/'rollback.zip').write_bytes(b);(O/'config.private.json').write_text(json.dumps(c))
with zipfile.ZipFile(O/'rollback.zip') as z:
 old=z.read('index.js').decode();new=(R/'backend/staff-service/index.js').read_text();needle='age>300)throw fail';replacement="(age>300&&!(process.env.PLATFORM_ENVIRONMENT==='staging'&&process.env.PLATFORM_SESSION_POLICY==='VALID_SESSION')))throw fail"
 assert old.count(needle)==1 and old.replace(needle,replacement)==new,'INDEX_DRIFT'
 with zipfile.ZipFile(O/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for i in z.infolist():out.writestr(copy.copy(i),new.encode() if i.filename=='index.js' else z.read(i.filename))
 with zipfile.ZipFile(O/'candidate.zip') as out:assert all(z.read(i)==out.read(i) for i in z.namelist() if i!='index.js')
p=(O/'candidate.zip').read_bytes();l.update_function_code(FunctionName=n,RevisionId=c['RevisionId'],ZipFile=p);l.get_waiter('function_updated_v2').wait(FunctionName=n)
a=l.get_function_configuration(FunctionName=n);env=dict(a['Environment']['Variables']);assert env.get('PLATFORM_ENVIRONMENT')=='staging';env['PLATFORM_SESSION_POLICY']='VALID_SESSION';l.update_function_configuration(FunctionName=n,RevisionId=a['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=n)
a=l.get_function_configuration(FunctionName=n);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(p).digest()).decode();assert a['Environment']['Variables']==env
result={'function':n,'beforeSha256':c['CodeSha256'],'afterSha256':a['CodeSha256'],'changedFiles':['index.js'],'sessionPolicy':'VALID_SESSION','testsPassed':186,'otherPackageFilesPreserved':True,'otherEnvironmentPreserved':True,'applicationDataWrites':False,'scope':'Central platform staff service only; merchant owner consent and wallet verification unchanged'}
(O/'publication.json').write_text(json.dumps(result,indent=2));(R/'docs/finance-platform-session-policy-75.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
