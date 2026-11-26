"""Publish narrowly scoped guards on captured hosts, retaining runtime/env/code overlays."""
from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/driver-flow-audit-292');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1'];names=['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_HandleDriverReject']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
for n in names:
 q=P/n;z=zipfile.ZipFile(q/'base.zip');s=z.read('index.js').decode();source=(R/'lambda'/n/'index.js').read_text()
 if n=='WaveSystem_StartWave':
  start=source.index('    // General release cannot fall back');end=source.index('    const financialSource =',start);needle='    const financialSource =';addition=source[start:end]
 elif n=='WaveSystem_HandleWaveTimeout':
  needle='    if (financialJob?.financialDispatch === true) {';start=source.index("    if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'&&process.env.FINANCE_GENERAL_RELEASE_MODE==='REQUIRED'){result.skipped=");end=source.index(needle,start);addition=source[start:end]
 else:
  needle='    // Pinned cycles must never enter legacy decline/metrics writes.';start=source.index('    // Financial requests must use');end=source.index(needle,start);addition=source[start:end]
 assert s.count(needle)==1;s=s.replace(needle,addition+needle)
 if n=='WaveSystem_HandleDriverReject':
  needle='    // Step 1: تحديث WaveOffer status → rejected';assert s.count(needle)==1;s=s.replace(needle,"    if(!cycleJob.Item)return {statusCode:409,body:JSON.stringify({success:false,code:'DISPATCH_JOB_REQUIRED'})};\n\n"+needle)
 (q/'candidate-index.js').write_text(s);subprocess.run(['node','--check',str(q/'candidate-index.js')],check=True)
 with zipfile.ZipFile(q/'candidate.zip','w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),s.encode()if info.filename=='index.js'else z.read(info.filename))
 zz=zipfile.ZipFile(q/'candidate.zip');assert all(z.read(k)==zz.read(k)for k in z.namelist()if k!='index.js')
subprocess.run(['node','scripts/test-wave-legacy-fences-292.cjs'],cwd=R,check=True)
report={'status':'PUBLISHING','functions':[],'iamChanged':False,'businessDataWritten':False,'tests':7}
for n in names:
 q=P/n;old=json.loads((q/'config.private.json').read_text());cfg=aws('lambda','get-function-configuration','--function-name',n);assert cfg['CodeSha256']==old['CodeSha256'];data=(q/'candidate.zip').read_bytes();sha=base64.b64encode(hashlib.sha256(data).digest()).decode();aws('lambda','update-function-code','--function-name',n,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(q/'candidate.zip'));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',n]);after=aws('lambda','get-function','--function-name',n);actual=after['Configuration'];assert actual['CodeSha256']==sha
 for k in ['Role','Environment','MemorySize','Timeout','Handler','Runtime']:assert actual.get(k)==cfg.get(k)
 assert urllib.request.urlopen(after['Code']['Location'],timeout=45).read()==data
 report['functions'].append({'name':n,'beforeHash':cfg['CodeSha256'],'hash':sha,'changedFiles':['index.js'],'allOtherEntriesPreserved':True,'configurationPreserved':True});(R/'docs/wave-legacy-fences-publication-292.json').write_text(json.dumps(report,indent=2)+'\n');print(n+' published and byte verified',flush=True)
 # Keep current performance deployment receipt coherent with the narrow host overlay.
 p=R/'docs/driver-performance-projection-publication-291.json';r=json.loads(p.read_text())
 for e in r['functions']:
  if e['name']==n:e['hash']=sha;e['subsequentOverlay']='wave-legacy-fences-publication-292.json'
 p.write_text(json.dumps(r,indent=2)+'\n')
report['status']='PUBLISHED_BYTE_VERIFIED';(R/'docs/wave-legacy-fences-publication-292.json').write_text(json.dumps(report,indent=2)+'\n')
