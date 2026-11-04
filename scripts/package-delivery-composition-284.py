"""Offline bounded archives; every unrelated live ZIP entry is preserved."""
import pathlib,json,zipfile,hashlib,base64,copy
p=pathlib.Path('/private/tmp/delivery-284');plans=json.loads((p/'plans.json').read_text());records=[]
for row in plans:
 if not row['publish']:continue
 before=p/(row['function']+'-base.zip');destination=p/(row['function']+'-candidate.zip');changes={k:pathlib.Path(v).read_bytes()for k,v in row['changes'].items()}
 with zipfile.ZipFile(before)as old:
  assert base64.b64encode(hashlib.sha256(before.read_bytes()).digest()).decode()==row['hash']
  with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED)as new:
   for entry in old.infolist():new.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry.filename)))
   for name,raw in changes.items():
    if name not in old.namelist():new.writestr(name,raw)
  with zipfile.ZipFile(destination)as new:
   assert set(new.namelist())==set(old.namelist())|set(changes)
   for name in old.namelist():
    if name not in changes:assert old.read(name)==new.read(name),name
   assert all(new.read(name)==raw for name,raw in changes.items())
  records.append({'function':row['function'],'baseCodeSha256':row['hash'],'baseRevisionId':row['revisionId'],'candidateCodeSha256':base64.b64encode(hashlib.sha256(destination.read_bytes()).digest()).decode(),'changedFiles':list(changes),'preservedEntries':len([n for n in old.namelist()if n not in changes]),'factoryProofs':row['proofs']})
(p/'packages.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps({'status':'PREPARED','functions':len(records),'unrelatedEntriesPreserved':True}))
