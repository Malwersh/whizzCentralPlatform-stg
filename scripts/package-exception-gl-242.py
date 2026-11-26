"""Build bounded overlays from freshly captured staging packages. No remote mutations."""
import pathlib,json,zipfile,copy,hashlib,base64
r=pathlib.Path(__file__).resolve().parents[1];p=r/'backend/.tmp/order-exceptions-work/settlement-242-gl';src=r/'backend/staff-service'
changes={
'financial':{'index.js':p/'financial-candidate.js','order-exception-runtime-229.js':p/'order-exception-runtime-229.js'},
'staff':{n:src/n for n in ['settlement-runtime.js','merchant-account-index-runtime.js','merchant-account.js','settlement-orders.js','settlement-evidence-fields.json','order-exception-cases.js']},
}
manifest=[]
for label,files in changes.items():
 before=json.loads((p/(label+'-config.private.json')).read_text());base=(p/(label+'-base.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(base).digest()).decode()==before['CodeSha256']
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  assert all(n in old.namelist()for n in files),'MISSING_EXISTING_ENTRY '+label
  with zipfile.ZipFile(p/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),files[info.filename].read_bytes()if info.filename in files else old.read(info.filename))
  with zipfile.ZipFile(p/(label+'-candidate.zip'))as out:assert all(out.read(n)==old.read(n)for n in old.namelist()if n not in files)
 raw=(p/(label+'-candidate.zip')).read_bytes();manifest.append({'label':label,'name':before['FunctionName'],'baseCodeSha256':before['CodeSha256'],'codeSha256':base64.b64encode(hashlib.sha256(raw).digest()).decode(),'changedFiles':list(files),'unrelatedEntriesPreserved':True})
(p/'package-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n');print('PASS two bounded archives; configuration and unrelated entries preserved.')
