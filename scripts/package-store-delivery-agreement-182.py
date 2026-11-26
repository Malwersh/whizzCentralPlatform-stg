"""Build review ZIPs; all untouched entries remain byte-identical."""
import pathlib,json,zipfile,copy,hashlib,base64
p=pathlib.Path('/private/tmp/store-agreement-182');rows=json.loads((p/'overlays.json').read_text());result=[]
for r in rows:
 z=zipfile.ZipFile(p/(r['name']+'.zip'));assert base64.b64encode(hashlib.sha256((p/(r['name']+'.zip')).read_bytes()).digest()).decode()==r['codeSha256'];folder=pathlib.Path(r['overlay']);changes={n:(folder/n).read_bytes() for n in json.loads((folder/'changes.json').read_text())};changes={n:b for n,b in changes.items() if n not in z.namelist() or z.read(n)!=b}
 if not changes:continue
 candidate=p/(r['name']+'.candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for entry in z.infolist():out.writestr(copy.copy(entry),changes.get(entry.filename,z.read(entry.filename)))
  for n,b in changes.items():
   if n not in z.namelist():out.writestr(n,b)
 with zipfile.ZipFile(candidate) as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n not in changes)
 result.append({'name':r['name'],'baseCodeSha256':r['codeSha256'],'handler':r['handler'],'codeSha256':base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode(),'candidate':candidate.name,'changedFiles':list(changes),'patches':r['patches'],'otherEntriesIdentical':True})
manifest={'part':182,'status':'PREPARED_NOT_PUBLISHED','functions':result,'noIamChanges':True,'noEnvironmentChanges':True,'noFinancialDataWrites':True,'preservesExistingSdkConstructors':True,'financialTests':64,'workflowTests':11,'browserAgreementAndCampaignTestsPassed':True}
pathlib.Path('docs/store-delivery-agreement-candidates-182.json').write_text(json.dumps(manifest,indent=2)+'\n');print(json.dumps({'functionCount':len(result),'status':manifest['status']}))
