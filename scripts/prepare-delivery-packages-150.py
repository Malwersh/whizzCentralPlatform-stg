"""Create private ZIP overlays from captured live packages. Never deploys."""
import base64,copy,hashlib,io,json,os,pathlib,sys,zipfile
R=pathlib.Path(__file__).resolve().parents[1];A=pathlib.Path(sys.argv[1]);O=pathlib.Path(sys.argv[2]);B=O/'bundles';O.mkdir(parents=True,exist_ok=True,mode=0o700)
inv=json.loads((A/'inventory.private.json').read_text());extra=json.loads((O/'extra-inventory.private.json').read_text());configs={x['name']:x for x in inv['functions']};notification=extra['notification'];configs[notification['name']]={'name':notification['name'],'handler':notification['Handler'],'revisionId':notification['RevisionId'],'codeSha256':notification['CodeSha256']}
rows=[]
def data(file):return file.read_bytes()
def overlay(name,changes):
 base=(A if name in [x['name'] for x in inv['functions']] else O)/(name+'.zip');config=configs[name];raw=data(base);assert base64.b64encode(hashlib.sha256(raw).digest()).decode()==config['codeSha256']
 target=O/(name+'.candidate.zip')
 with zipfile.ZipFile(io.BytesIO(raw)) as old:
  assert len(old.namelist())==len(set(old.namelist())),'DUPLICATE_BASE_ENTRIES'
  changes={n:b for n,b in changes.items() if n not in old.namelist() or old.read(n)!=b}
  with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as new:
   for entry in old.infolist():new.writestr(copy.copy(entry),changes.get(entry.filename,old.read(entry)))
   for n,b in changes.items():
    if n not in old.namelist():new.writestr(n,b)
  with zipfile.ZipFile(target) as new:assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
 os.chmod(target,0o600);rows.append({'name':name,'baseRevisionId':config['revisionId'],'baseCodeSha256':config['codeSha256'],'candidate':target.name,'codeSha256':base64.b64encode(hashlib.sha256(data(target)).digest()).decode(),'changedFiles':sorted(changes),'untouchedEntriesVerified':True,'handler':config['handler']})
# Preserve the deployed legacy router/handler; only canonical financial code changes.
customer=R.parent/'wizzuser-stg/backend/src/functions'
overlay('WizzUser-CreateOrder-staging',{'functions/create-order/commercial-runtime.js':data(B/'commercial-runtime.js'),'functions/shared/customer-order-view.js':data(customer/'shared/customer-order-view.js')})
# Canonical staff source plus its complete generated pricing closure; only changed bytes are overlaid.
staff=R/'backend/staff-service';changes={n:data(staff/n) for n in ['index.js','commercial-management.js','commercial-notices.js','delivery-options.js']}
changes.update({'pricing-runtime/'+p.name:data(p) for p in (staff/'pricing-runtime').glob('*.js')});overlay('staging-wizz-staff-service',changes)
overlay('staging-driver-financial-accept',{'index.js':data(B/'financial-runtime.js')});overlay('staging-cod-integration',{'index.js':data(B/'cod-integration.js')});overlay('staging-merchant-response-99',{'index.js':data(B/'merchant-response-worker.js')})
name='order-receiver-merchant-orders-staging-v1'
with zipfile.ZipFile(A/(name+'.zip')) as z:s=z.read('merchant_order_handler.js').decode()
needle='adapter.createMerchantPendingResponse({db:responseDb,authenticate:';assert s.count(needle)==1
s=s.replace(needle,"adapter.createMerchantPendingResponse({db:responseDb,enableDeliveryFunding:process.env.FINANCIAL_DELIVERY_FUNDING_MODE==='REQUIRED',authenticate:")
overlay(name,{'merchant_order_handler.js':s.encode(),'merchant_pending_response.js':data(B/'merchant_pending_response.js')})
for name in ['WaveSystem_CreateDispatchJob','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout']:
 changes={'dispatch-cycle-runtime.js':data(B/'dispatch-cycle-runtime.js')}
 if name!='WaveSystem_CreateDispatchJob':changes['financial-runtime.js']=data(B/'financial-runtime.js')
 overlay(name,changes)
overlay(notification['name'],{'src/utils/commercial-sharing-push.js':data(B/'commercial-sharing-push.js')})
# Preserve every web asset; patch only the existing merchant page and two new scripts.
raw=data(O/'frontend.base.zip');assert hashlib.sha256(raw).hexdigest()==extra['frontend']['artifactSha256'];target=O/'frontend.candidate.zip'
with zipfile.ZipFile(io.BytesIO(raw)) as old:
 pages=[n for n in old.namelist() if n.endswith('pages/merchants.html')];assert len(pages)==1;page=pages[0];prefix=page[:-len('pages/merchants.html')];s=old.read(page).decode();anchor='<details data-commercial-kind="AGREEMENT"';assert s.count(anchor)==1 and 'data-delivery-policies' not in s
 section='<details data-delivery-policies dir="rtl" style="background:white;padding:20px;margin-bottom:20px;border-radius:16px"><summary>عروض التوصيل وتمويلها</summary><p>إرسال عرض توصيل محدد التمويل والميزانية إلى مالك المتجر أو مديره للموافقة.</p></details>\n'
 s=s.replace(anchor,section+anchor,1);assert s.count('</body>')==1;s=s.replace('</body>','<script src="../delivery-policy-form.js?v=150"></script><script src="../delivery-policy-management.js?v=150"></script>\n</body>',1)
 changes={page:s.encode(),**{prefix+n:data(R/'frontend'/n) for n in ['delivery-policy-form.js','delivery-policy-management.js']}}
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as new:
  for e in old.infolist():new.writestr(copy.copy(e),changes.get(e.filename,old.read(e)))
  for n,b in changes.items():
   if n not in old.namelist():new.writestr(n,b)
 with zipfile.ZipFile(target) as new:assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
os.chmod(target,0o600)
manifest={'part':150,'reviewOnly':True,'applied':False,'activation':'OFF','functions':rows,'frontend':{**extra['frontend'],'candidate':target.name,'candidateSha256':hashlib.sha256(data(target)).hexdigest(),'changedFiles':sorted(changes),'untouchedEntriesVerified':True},'preserved':['legacy customer handler/router','existing Lambda handler names','unrelated ZIP entries','merchant deployed require paths','unrelated frontend assets'],'configurationChangesApplied':False,'blockers':['No IAM or publication approval/application in this artifact','Need current-code/revision and role-policy drift recheck','Hosted-financial scheduling remains gated','Device build/verification and original-share refunds/partial returns pending']}
p=O/'package-manifest.json';p.write_text(json.dumps(manifest,indent=2)+'\n');os.chmod(p,0o600);print(json.dumps({'functionOverlays':len(rows),'webOverlay':True,'allUntouchedEntriesVerified':True,'applied':False}))
