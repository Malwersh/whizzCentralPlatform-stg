"""Prepare three code-only ZIP overlays against the captured live hashes."""
import pathlib,json,zipfile,hashlib,base64,copy
p=pathlib.Path('/private/tmp/financial-retry-192');rows=[]
for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','staging-driver-financial-accept']:
 cfg=json.loads((p/(name+'.private.json')).read_text());before=p/(name+'.zip');assert base64.b64encode(hashlib.sha256(before.read_bytes()).digest()).decode()==cfg['CodeSha256'];z=zipfile.ZipFile(before)
 changes={'finance-rollout.js':(p/'finance-rollout.js').read_bytes()}
 if name=='staging-driver-financial-accept':changes['index.js']=(p/'financial-runtime.js').read_bytes()
 else:changes.update({'dispatch-cycle-runtime.js':(p/'dispatch-cycle-runtime.js').read_bytes(),'financial-runtime.js':(p/'financial-runtime.js').read_bytes()})
 assert all(n in z.namelist() for n in changes)
 candidate=p/(name+'.candidate.zip')
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
  for e in z.infolist():out.writestr(copy.copy(e),changes.get(e.filename,z.read(e.filename)))
 with zipfile.ZipFile(candidate) as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n not in changes)
 rows.append({'name':name,'handler':cfg['Handler'],'baseCodeSha256':cfg['CodeSha256'],'candidate':str(candidate),'candidateCodeSha256':base64.b64encode(hashlib.sha256(candidate.read_bytes()).digest()).decode(),'changedFiles':list(changes),'otherEntriesIdentical':True})
(p/'candidates.json').write_text(json.dumps(rows,indent=2)+'\n');print(json.dumps(rows))
