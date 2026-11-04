import pathlib,json,importlib.util,urllib.request,zipfile
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing76');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();l=s.client('lambda')
names={'staff':'staging-wizz-staff-service','writer':'WizzUser-CreateOrder-staging','worker':'staging-account-deletion-worker','expiry':'staging-account-deletion-financial-expiry'};report={}
for key,name in names.items():
 f=l.get_function(FunctionName=name);(O/(key+'.base.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read());(O/(key+'.config.private.json')).write_text(json.dumps(f['Configuration']));report[key]={'name':name,'codeSha256':f['Configuration']['CodeSha256'],'revisionId':f['Configuration']['RevisionId']}
 with zipfile.ZipFile(O/(key+'.base.zip')) as z:print(key,[n for n in z.namelist() if n in ['commercial-management.js','commercial-options.js','commercial-retention.js','financial-purge.js'] or 'commercial-runtime' in n])
(O/'inventory.json').write_text(json.dumps(report,indent=2))
