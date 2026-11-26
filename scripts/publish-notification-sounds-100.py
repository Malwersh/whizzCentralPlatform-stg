"""Overlay notification assets/tracking only, preserving deployed ZIP entries and config."""
from pathlib import Path
import importlib.util,json,io,zipfile,urllib.request,hashlib,base64,time
R=Path(__file__).resolve().parents[1];B=R.parent;O=Path('/private/tmp/notification100');O.mkdir(exist_ok=True)
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);s=m.session();l=s.client('lambda')
C=R/'backend';M=B/'whizzMerchants-stg/backend/functions'
common={f'staff-service/{n}':C/'staff-service'/n for n in ['notification-settings-contract.js','notification-sound-assets.js']}
common.update({'src/handlers/notification-sound-policy.js':C/'src/handlers/notification-sound-policy.js','src/utils/notification-sound-message.js':C/'src/utils/notification-sound-message.js'})
changes={'staging-wizz-staff-service':{n:C/'staff-service'/n for n in ['notification-settings-contract.js','notification-sound-assets.js']}}
for short in ['pushSoundSettings','pushTokensRegister','pushSendMerchantOrder','pushSendWaveOffer']:
 patches=dict(common)
 for n in {'pushSoundSettings':['push-tokens.js'],'pushTokensRegister':['push-tokens.js'],'pushSendMerchantOrder':['push-merchant-order.js'],'pushSendWaveOffer':['push-wave-offer.js']}[short]:patches['src/handlers/'+n]=C/'src/handlers'/n
 if short=='pushSendWaveOffer':patches['src/utils/pinned-wave-push-handler.js']=C/'src/utils/pinned-wave-push-handler.js'
 changes['wizzcentral-notifications-staging-'+short]=patches
changes['wizzcentral-notifications-staging-pushSendOrderUpdate']={'src/handlers/push-order-update.js':C/'src/handlers/push-order-update.js','src/handlers/order-arrival-content.js':C/'src/handlers/order-arrival-content.js'}
for name in ['order-receiver-regional-staging-unified-auth-v4-sam','order-receiver-merchant-orders-staging-v1']:
 changes[name]={'branch_devices.js':M/'auth/branch_devices.js','shared/notification-sound-policy.js':M/'shared/notification-sound-policy.js'}
manifest=[]
for name,patches in changes.items():

 if '--use-capture' in __import__('sys').argv:
  conf=json.loads((O/(name+'.config.private.json')).read_text());raw=(O/(name+'.before.zip')).read_bytes()
 else:
  f=l.get_function(FunctionName=name);conf=f['Configuration'];raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read()
 (O/(name+'.before.zip')).write_bytes(raw);cfg=O/(name+'.config.private.json');cfg.write_text(json.dumps(conf,default=str));cfg.chmod(0o600)
 buf=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(raw)) as old,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as new:
  # Both merchant handlers already use root-layout branch_devices/shared modules.
  def content(n):
   data=patches[n].read_bytes()
   if n=='branch_devices.js':data=data.decode().replace("require('../../merchant-platform/","require('./merchant-platform/").replace("require('../shared/","require('./shared/").encode()
   return data
  for n in old.namelist():new.writestr(n,content(n) if n in patches else old.read(n))
  for n,p in patches.items():
   if n not in old.namelist():new.writestr(n,p.read_bytes())
  assert all(new.read(n)==old.read(n) for n in old.namelist() if n not in patches)
 payload=buf.getvalue();(O/(name+'.candidate.zip')).write_bytes(payload)
 manifest.append({'name':name,'baseRevision':conf['RevisionId'],'sha256':base64.b64encode(hashlib.sha256(payload).digest()).decode(),'files':list(patches)})
(O/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'prepared':len(manifest)}),flush=True)
if '--publish' not in __import__('sys').argv:raise SystemExit()
proof=[]
for item in manifest:
 name=item['name'];old=json.loads((O/(name+'.config.private.json')).read_text());cur=l.get_function_configuration(FunctionName=name);assert cur['RevisionId']==item['baseRevision'];l.update_function_code(FunctionName=name,RevisionId=cur['RevisionId'],ZipFile=(O/(name+'.candidate.zip')).read_bytes());l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':1,'MaxAttempts':90});now=l.get_function_configuration(FunctionName=name);assert now['CodeSha256']==item['sha256']
 for k in ['Environment','Role','Runtime','Handler','Timeout','Layers','Architectures']:assert now.get(k)==old.get(k)
 proof.append({'name':name,'sha256':item['sha256']});(O/'publication.json').write_text(json.dumps({'functions':proof,'complete':False},indent=2));print(json.dumps({'published':name}),flush=True)
(O/'publication.json').write_text(json.dumps({'functions':proof,'complete':True,'configPreserved':True},indent=2))
