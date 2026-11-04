"""Bounded push cold-start allowance; retain financial offer references and all host guards."""
from pathlib import Path
import json,subprocess,zipfile,copy,hashlib,base64,urllib.request
R=Path(__file__).resolve().parents[1];P=Path('/private/tmp/order-ORD1792947001532');BASE=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(BASE+list(a));return json.loads(raw)if raw.strip()else{}
report={'status':'PUBLISHING','observedPushHandlerDurationMs':4322.26,'previousHttpTimeoutMs':3000,'newHttpTimeoutMs':8000,'boundedByOfferExpiry':True,'iamChanged':False,'businessDataWritten':False,'functions':[]}
manifest=R/'docs/driver-performance-projection-publication-291.json';m=json.loads(manifest.read_text())
for name in ['WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 cfg=aws('lambda','get-function-configuration','--function-name',name);prior=next(x for x in m['functions']if x['name']==name);assert cfg['CodeSha256']==prior['hash'];q=P/name;q.mkdir(exist_ok=True);z=zipfile.ZipFile(Path('/private/tmp/driver-flow-audit-292')/name/'candidate.zip');s=z.read('dispatch-cycle-runtime.js').decode();needle='function createWaveOfferTransport({ api, notificationsBase, internalKey, request = postJson }) {';assert s.count(needle)==1
 s=s.replace(needle,needle+"\n      return require('./wave-offer-transport-293.js').createWaveOfferTransport({api,notificationsBase,internalKey,...(request===postJson?{}:{request})});")
 changes={'dispatch-cycle-runtime.js':s.encode(),'wave-offer-transport-293.js':(R/'lambda/WaveSystem_StartWave/wave-offer-transport.js').read_bytes()}
 target=q/'candidate.zip'
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  out.writestr('wave-offer-transport-293.js',changes['wave-offer-transport-293.js'])
 zz=zipfile.ZipFile(target);assert all(zz.read(n)==z.read(n)for n in z.namelist()if n not in changes)
 for n,data in changes.items():f=q/n;f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
 # Exercise actual host wrapper with an injected transport; no network or orders.
 a=s.index(needle);b=s.index('    __name(createWaveOfferTransport',a);(q/'wrapper.cjs').write_text("const postJson=()=>{throw Error('unexpected default transport')};\n"+s[a:b]+'\nmodule.exports={createWaveOfferTransport};')
 code="const a=require('assert/strict'),{createWaveOfferTransport}=require('./wrapper.cjs');(async()=>{let timeout;await createWaveOfferTransport({api:{},notificationsBase:'https://fixture.invalid',internalKey:'fixture',request:async(...x)=>{timeout=x[3];return {};}}).postPush({});a.equal(timeout,8000);})().catch(e=>{console.error(e);process.exitCode=1;});"
 subprocess.run(['node','-e',code],cwd=q,check=True)
 aws('lambda','update-function-code','--function-name',name,'--revision-id',cfg['RevisionId'],'--zip-file','fileb://'+str(target));subprocess.check_call(BASE+['lambda','wait','function-updated-v2','--function-name',name]);after=aws('lambda','get-function','--function-name',name);actual=after['Configuration'];sha=base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode();assert actual['CodeSha256']==sha
 for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize']:assert actual.get(k)==cfg.get(k)
 assert urllib.request.urlopen(after['Code']['Location'],timeout=45).read()==target.read_bytes();report['functions'].append({'name':name,'beforeHash':cfg['CodeSha256'],'hash':sha,'changedFiles':list(changes),'unrelatedEntriesPreserved':True,'configurationPreserved':True});prior['hash']=sha;prior['subsequentOverlay']='wave-push-timeout-publication-293.json';manifest.write_text(json.dumps(m,indent=2)+'\n');(R/'docs/wave-push-timeout-publication-293.json').write_text(json.dumps(report,indent=2)+'\n');print(name+' bounded push timeout published, ENFORCE preserved',flush=True)
report['status']='PUBLISHED_BYTE_VERIFIED';(R/'docs/wave-push-timeout-publication-293.json').write_text(json.dumps(report,indent=2)+'\n')
