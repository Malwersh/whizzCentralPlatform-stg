import pathlib,importlib.util,json,urllib.request,zipfile
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing78');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();l=s.client('lambda');inv={}
for k,n in [('staff','staging-wizz-staff-service'),('push','wizzcentral-notifications-staging-pushSendMerchantOrder'),('worker','staging-account-deletion-worker'),('expiry','staging-account-deletion-financial-expiry')]:
 f=l.get_function(FunctionName=n);c=f['Configuration'];(O/(k+'.base.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read());(O/(k+'.config.private.json')).write_text(json.dumps(c));inv[k]={'name':n,'codeSha256':c['CodeSha256'],'revisionId':c['RevisionId'],'role':c['Role'],'handler':c['Handler']}
 with zipfile.ZipFile(O/(k+'.base.zip')) as z:print(k,c['Handler'],[n for n in z.namelist() if n.endswith('push-merchant-order.js') or n.endswith('firebase.js')][:6])
(O/'inventory.json').write_text(json.dumps(inv,indent=2))
