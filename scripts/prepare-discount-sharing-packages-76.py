import pathlib,zipfile,copy,json,subprocess,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing76');U=R.parent/'wizzuser-stg';configs={
 'staff':{'commercial-management.js':R/'backend/staff-service/commercial-management.js','commercial-options.js':R/'backend/staff-service/commercial-options.js'},
 'writer':{'functions/create-order/commercial-runtime.js':O/'commercial-runtime.js','functions/create-order/quote-runtime/orderCommercialSource.js':U/'backend/src/functions/create-order/quote-runtime/orderCommercialSource.js'},
 'worker':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js'},
 'expiry':{'commercial-retention.js':R/'backend/account-deletion/commercial-retention.js','financial-purge.js':R/'backend/account-deletion/financial-purge.js'}}
report={}
for key,files in configs.items():
 with zipfile.ZipFile(O/(key+'.base.zip')) as z:
  with zipfile.ZipFile(O/(key+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),files[info.filename].read_bytes() if info.filename in files else z.read(info.filename))
  with zipfile.ZipFile(O/(key+'.candidate.zip')) as out:assert all(z.read(n)==out.read(n) for n in z.namelist() if n not in files)
 payload=(O/(key+'.candidate.zip')).read_bytes();report[key]={'changedFiles':list(files),'codeSha256':base64.b64encode(hashlib.sha256(payload).digest()).decode()}
(O/'preparation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
