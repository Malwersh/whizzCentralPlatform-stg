"""Build local overlays above freshly captured live ZIPs. Never deploys or changes flags."""
import base64,copy,difflib,hashlib,json,os,pathlib,sys,zipfile
R=pathlib.Path(__file__).resolve().parents[1];A=pathlib.Path(sys.argv[1]);O=pathlib.Path(sys.argv[2]);B=O/'bundles';O.mkdir(parents=True,exist_ok=True,mode=0o700)
inventory=json.loads((A/'inventory.private.json').read_text());configs={r['FunctionName']:r for r in inventory['functions']};rows=[]
def read(name,path):
 with zipfile.ZipFile(A/(name+'.zip')) as z:return z.read(path)
def overlay(name,changes):
 config=configs[name];base=A/(name+'.zip');assert base64.b64encode(hashlib.sha256(base.read_bytes()).digest()).decode()==config['CodeSha256']
 target=O/(name+'.candidate.zip')
 with zipfile.ZipFile(base) as old:
  assert len(old.namelist())==len(set(old.namelist()))
  changes={n:v for n,v in changes.items() if n not in old.namelist() or old.read(n)!=v}
  with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as new:
   for entry in old.infolist():new.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry)))
   for n,v in changes.items():
    if n not in old.namelist():new.writestr(n,v)
  with zipfile.ZipFile(target) as new:assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 os.chmod(target,0o600);rows.append({'name':name,'handler':config['Handler'],'baseRevisionId':config['RevisionId'],'baseCodeSha256':config['CodeSha256'],'candidate':target.name,'codeSha256':base64.b64encode(hashlib.sha256(target.read_bytes()).digest()).decode(),'changedFiles':sorted(changes),'untouchedEntriesVerified':True,'environmentSha256':config['environmentSha256']})
overlay('WaveSystem_CreateDispatchJob',{'dispatch-cycle-runtime.js':(B/'dispatch-cycle-runtime.js').read_bytes()})
name='WaveSystem_StartWave';source=read(name,'index.js').decode();local=(R/'lambda/WaveSystem_StartWave/index.js').read_text()
line=next(l for l in local.splitlines(True) if l.strip().startswith("if(process.env.DISPATCH_FINANCIAL_HOST_MODE==='REQUIRED'"));anchor="    if (Object.prototype.hasOwnProperty.call(dispatchJob,'dispatchCycle')) {"
assert source.count(anchor)==1 and 'runHostedFinancialWave' not in source
source=source.replace(anchor,anchor+'\n'+line,1)
overlay(name,{'index.js':source.encode(),'dispatch-cycle-runtime.js':(B/'dispatch-cycle-runtime.js').read_bytes()})
name='WaveSystem_HandleWaveTimeout';source=read(name,'index.js').decode();local=(R/'lambda/WaveSystem_HandleWaveTimeout/index.js').read_text()
diff=list(difflib.ndiff(source.splitlines(),local.splitlines()));assert sum(l.startswith(('+ ','- ')) for l in diff)==3,'UNEXPECTED_TIMEOUT_SOURCE_DIFF'
overlay(name,{'index.js':local.encode(),'dispatch-cycle-runtime.js':(B/'dispatch-cycle-runtime.js').read_bytes()})
overlay('staging-driver-financial-accept',{'index.js':(B/'financial-runtime.js').read_bytes()})
name='DriversApi-staging';changes={}
for file,expected in [('lambda_driver_api_v2.js',7),('financial-accept-client.js',5)]:
 local=(R.parent/'whizzDrivers-stg/backend'/file).read_bytes();diff=list(difflib.ndiff(read(name,file).decode().splitlines(),local.decode().splitlines()));assert sum(l.startswith(('+ ','- ')) for l in diff)==expected,'UNEXPECTED_DRIVER_SOURCE_DIFF'
 changes[file]=local
overlay(name,changes)
name='wizzcentral-notifications-staging-pushSendWaveOffer';file='src/handlers/push-wave-offer.js';local=(R/'backend'/file).read_bytes();diff=list(difflib.ndiff(read(name,file).decode().splitlines(),local.decode().splitlines()));assert sum(l.startswith(('+ ','- ')) for l in diff)==5,'UNEXPECTED_NOTIFICATION_SOURCE_DIFF'
overlay(name,{file:local,'src/utils/financial-offer-notification-runtime.js':(B/'financial-offer-notification-runtime.js').read_bytes()})
report={'part':156,'localOnly':True,'applied':False,'functions':rows,'configurationChanges':{},'frontendChanges':False,'note':'Candidate code only. Host/validation/push modes remain unchanged. API Gateway uses existing deployed proxy; driver app build still requires coordination.'}
(O/'package-manifest.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'candidatePackages':len(rows),'untouchedEntriesVerified':True,'applied':False}))
