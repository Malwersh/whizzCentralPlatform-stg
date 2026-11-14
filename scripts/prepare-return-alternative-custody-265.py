import pathlib,zipfile,copy,json,hashlib,subprocess
r=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/return-alternative-custody-265');records=[]
def overlay(raw):
 marker=b'// Continuation 264:';at=raw.rfind(marker);assert at>=0;prefix,tail=raw[:at],raw[at:];assert tail.count(b'./return-continuation-runtime-264.js')==1;tail=tail.replace(b'./return-continuation-runtime-264.js',b'./return-continuation-runtime-265.js',1)
 needle=b'const original=previous.createExceptionCaseAdministration(options),financial=';assert tail.count(needle)==1;tail=tail.replace(needle,b'const original=previous.createExceptionCaseAdministration(options),disposition=previous.createExceptionCaseAdministration({...options,db:runtime.guardReturnDispositionDb(options.db)}),financial=',1);needle=b':original(value);},createStagingCodReturn:';assert tail.count(needle)==1;tail=tail.replace(needle,b':value?.action==="AUTHORIZE_RETURN"?disposition(value):original(value);},createStagingCodReturn:',1);needle=b'runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options))';assert tail.count(needle)==1;tail=tail.replace(needle,b'runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options),previous.createStagingCodReturn)',1);return prefix+tail
for label in ['financial','staff']:
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  if label=='financial':changes={'order-exception-runtime-229.js':overlay(old.read('order-exception-runtime-229.js')),'return-continuation-runtime-265.js':(r/'backend/shared/return-continuation-runtime-265.js').read_bytes()}
  else:
   raw=(r/'backend/staff-service/order-exception-cases.js').read_bytes();assert raw.replace(b'origin:row.itemCustodyOrigin||null,',b'',1)==old.read('order-exception-cases.js');changes={'order-exception-cases.js':raw}
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),changes.get(e.filename,old.read(e.filename)))
   for n,b in changes.items():
    if n not in old.namelist():out.writestr(n,b)
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:
   assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
   for n,b in changes.items():
    if n.endswith('.js'):
     q=p/'syntax.js';q.write_bytes(b);subprocess.run(['node','--check',str(q)],check=True,capture_output=True)
  cfg=json.loads((p/(label+'-config.private.json')).read_text());records.append({'label':label,'function':cfg['FunctionName'],'changedFiles':list(changes),'baseCodeSha256':cfg['CodeSha256'],'packageSha256':hashlib.sha256((p/(label+'-candidate.zip')).read_bytes()).hexdigest(),'unrelatedEntriesPreserved':True})
(p/'packages.json').write_text(json.dumps(records,indent=2));print(json.dumps([{k:v for k,v in f.items()if k in ['label','function','changedFiles']}for f in records],indent=2))
local=r/'backend/shared/order-exception-runtime-229.js';raw=local.read_bytes()
if b'./return-continuation-runtime-264.js'in raw:local.write_bytes(overlay(raw))
elif b'runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options))'in raw:local.write_bytes(raw.replace(b'runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options))',b'runtime.decorateReturnFactory(options,previous.createStagingCodReturn(options),previous.createStagingCodReturn)',1))

q=p/'candidate-runtime';q.mkdir(exist_ok=True)
with zipfile.ZipFile(p/'financial-candidate.zip')as z:
 for n in ['order-exception-runtime-229.js','return-item-plan-runtime-263.js','return-continuation-runtime-264.js','return-continuation-runtime-265.js','return-items-runtime-262.js','financial-compatibility.js']:(q/n).write_bytes(z.read(n))
