"""Apply only legal-consent source deltas to captured live packages; preserve unrelated live adapters."""
import pathlib,subprocess,difflib,zipfile,copy,json,hashlib,base64
root=pathlib.Path(__file__).resolve().parents[1];p=pathlib.Path('/private/tmp/customer-legal-344');result={}
for role,repo,src,entry,commit in [('phone','wizzuser-stg','backend/phone-auth/index.js','index.js','6d74c17'),('driver','whizzDrivers-stg','backend/lambda_driver_api_v2.js','lambda_driver_api_v2.js','1e4d90c'),('merchant','whizzMerchants-stg','backend/functions/auth/person_onboarding.js','person_onboarding.js','d2e5546')]:
 repo=root.parent/repo;old=subprocess.check_output(['git','show',commit+'^:'+src],cwd=repo).decode();new=(repo/src).read_text()
 with zipfile.ZipFile(p/(role+'-base.zip')) as z:
  original=z.read(entry).decode();patched=original
  # Each hunk must match once in the live file. Never overwrite its unrelated differences.
  a=old.splitlines(True);b=new.splitlines(True)
  groups=list(difflib.SequenceMatcher(None,a,b,autojunk=False).get_grouped_opcodes(2))
  for group in groups:
   left=''.join(a[group[0][1]:group[-1][2]]);right=''.join(b[group[0][3]:group[-1][4]])
   if patched.count(left)!=1:raise RuntimeError(f'{role}: nonunique or divergent legal hunk')
   patched=patched.replace(left,right,1)
  additions={n:(root/'backend/shared'/n).read_bytes() for n in ['customer-legal-contract-344.js','customer-legal-defaults-344.json','driver-legal-defaults-344.json','merchant-legal-defaults-344.json']}
  changes={entry:patched.encode(),**additions};target=p/(role+'-legal-344.zip')
  with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as out:
   for item in z.infolist():out.writestr(copy.copy(item),changes.get(item.filename,z.read(item.filename)))
   for n,data in changes.items():
    if n not in z.namelist():out.writestr(n,data)
  with zipfile.ZipFile(target) as out:
   for n in z.namelist():
    if n!=entry:assert out.read(n)==z.read(n),n
   unpack=p/(role+'-legal-unpacked');unpack.mkdir(exist_ok=True);out.extractall(unpack)
  subprocess.run(['node','--check',str(unpack/entry)],check=True)
  result[role]={'candidateCodeSha256':base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode(),'changedEntries':list(changes),'unrelatedEntriesPreserved':True,'sourceHunks':len(groups)}
(p/'consumer-manifest.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result,indent=2))
