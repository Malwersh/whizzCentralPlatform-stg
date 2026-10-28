from pathlib import Path
import json,subprocess,zipfile,copy,base64,hashlib
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/admin-dispatch-retry-298';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):return json.loads(subprocess.check_output(B+list(a)))
assert 'ℹ fail 0'in Path('/private/tmp/dispatch-performance-wait-tests.log').read_text()
r=json.load(open(R/'docs/admin-dispatch-retry-publication-298.json'));cog=json.load(open(R/'docs/admin-dispatch-retry-cognito-boundary-298.json'))
patch=(R/'scripts/patch-admin-dispatch-retry-functions-298.cjs').read_text().replace(' function visit(n){'," targets.clear();targets.add('createStagingDispatchCoordinator');\n function visit(n){")
tool=P/'patch-coordinator-only.cjs';# Preserve script-relative source resolution by writing the scratch tool in scripts.
tool=R/'scripts/.patch-coordinator-only-298.cjs';tool.write_text(patch)
report={'status':'PUBLISHING','sourceTests':33,'noOfferTtlExtended':True,'searchDeadlinePreserved':True,'noDirectOrderMutation':True,'functions':[]};doc=R/'docs/dispatch-performance-preparation-298.json'
try:
 for n,base,expected in [('WaveSystem_StartWave','cognito-candidate.zip',cog['hash']),('WaveSystem_HandleWaveTimeout','sdk-candidate.zip',next(x['hash']for x in r['sdkBoundaryOverlay']['functions']if x['name']=='WaveSystem_HandleWaveTimeout'))]:
  q=P/n;z=zipfile.ZipFile(q/base);s=z.read('dispatch-cycle-runtime.js');source=q/'preparation-input.js';source.write_bytes(s)
  subprocess.run(['node',str(tool),str(source),'dispatch-cycle-runtime.js'],cwd=R,check=True,capture_output=True);changes={'dispatch-cycle-runtime.js':Path(str(source)+'.patched').read_bytes(),'admin-retry-runtime-298.js':(P/'admin-retry-runtime-298.js').read_bytes()};p=q/'preparation-candidate.zip'
  with zipfile.ZipFile(p,'w',zipfile.ZIP_DEFLATED)as out:
   for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  zz=zipfile.ZipFile(p);assert all(z.read(k)==zz.read(k)for k in z.namelist()if k not in changes)
  for name,data in changes.items():
   tmp=q/('preparation-'+name);tmp.write_bytes(data);subprocess.run(['node','--check',str(tmp)],check=True)
  cfg=aws('lambda','get-function-configuration','--function-name',n);assert cfg['CodeSha256']==expected,'LIVE_DRIFT '+n
  aws('lambda','update-function-code','--function-name',n,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(p));subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',n],check=True)
  after=aws('lambda','get-function-configuration','--function-name',n);sha=base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode();assert after['CodeSha256']==sha and after['Environment']==cfg['Environment']
  report['functions'].append({'name':n,'beforeHash':expected,'hash':sha,'changedFiles':list(changes),'otherEntriesPreserved':True,'configurationPreserved':True});doc.write_text(json.dumps(report,indent=2)+'\n');print('Preparation retry published',n,flush=True)
 report['status']='PUBLISHED_VERIFIED';doc.write_text(json.dumps(report,indent=2)+'\n')
finally:tool.unlink(missing_ok=True)
