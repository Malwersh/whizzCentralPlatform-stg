"""Create reviewed deployment ZIPs with untouched entries verified byte for byte."""
import pathlib,json,zipfile,copy,hashlib,base64
p=pathlib.Path('/private/tmp/full-cash-208');data=json.loads((p/'packages/overlays.json').read_text());rows=[]
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
for r in data['functions']:
 source=p/'live'/(r['name']+'.zip');assert sha(source.read_bytes())==r['baseCodeSha256'];folder=pathlib.Path(r['overlay']);z=zipfile.ZipFile(source)
 changes={n:(folder/n).read_bytes() for n in r['changedFiles']};changes={n:b for n,b in changes.items() if n not in z.namelist() or z.read(n)!=b}
 if not changes:continue
 candidate=p/'packages'/(r['name']+'.candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for entry in z.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,z.read(entry.filename)))
  for n,b in changes.items():
   if n not in z.namelist():out.writestr(n,b)
 with zipfile.ZipFile(candidate) as out:
  assert all(z.read(n)==out.read(n) for n in z.namelist() if n not in changes)
  assert all(out.read(n)==b for n,b in changes.items())
 rows.append({**r,'changedFiles':list(changes),'candidate':str(candidate),'candidateCodeSha256':sha(candidate.read_bytes()),'otherEntriesIdentical':True})
manifest={'part':208,'status':'PREPARED_NOT_PUBLISHED','account':'699561669180','region':'us-east-1','functions':rows,'noFinancialDataWrites':True,'noActivationPerformed':True}
(p/'packages/candidates.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'functions':len(rows),'otherEntriesIdentical':True,'status':manifest['status']}))
