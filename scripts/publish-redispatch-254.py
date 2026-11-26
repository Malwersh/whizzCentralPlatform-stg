import pathlib,json,zipfile,copy,hashlib,base64,time,boto3,subprocess
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/redispatch-254'
s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');client=s.client('lambda')
sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
prior=json.loads((root/'docs/redispatch-publication-254.json').read_text()) if (root/'docs/redispatch-publication-254.json').exists() else {'functions':[]}
report={'part':254,'functions':[],'configurationChanged':False,'manualOrderReset':False}
for tag,name in [('start','WaveSystem_StartWave'),('timeout','WaveSystem_HandleWaveTimeout')]:
 old=p/tag/'dispatch-cycle-runtime.js';v=old.read_text()
 def replace(a,b):
  global v
  assert v.count(a)==1,(tag,a[:90],v.count(a));v=v.replace(a,b)
 replace(' || job.expiresAt !== cycle.searchDeadline','')
 replace('    const stop = job.status === "assigned"', '''    if(job.expiresAt!==cycle.searchDeadline&&!(cycle.engine==='FINANCIAL'&&order.financialRelease&&ms(job.expiresAt)>ms(cycle.startedAt)))return fail10();\n    const stop = job.status === "assigned"''')
 replace('if (offer.responseStatus === winner) accepted = true;', '''if (offer.responseStatus === winner) {
 const release=c.order.financialRelease,archive=financial&&release?await strongGet(db,'staging-Holds',{orderId:c.cycle.orderId,sk:'ASSIGNMENT_RELEASE#'+release.attempt}):null;
 if(!(archive?.kind==='COD_ASSIGNMENT_RELEASE'&&archive.outcome==='UNASSIGNED'&&archive.driverId===driverId&&archive.offerId===resolveFinancialOffer(offer.financialOffer,options.enableDeliveryFunding,options.enableFullCash).offerId&&archive.operationId===release.operationId&&archive.offerId===release.offerId&&archive.attempt===release.attempt))accepted=true;
}''')
 replace('const decision = decideDispatchTransition(c.cycle, progress, iso(time3));', '''let decision = decideDispatchTransition(c.cycle, progress, iso(time3));
 if(c.job.financialRedispatch&&c.cycle.engine==='FINANCIAL'){
 const r=c.job.financialRedispatch,release=c.order.financialRelease;
 if(!release||r.operationId!==release.operationId||r.waveNumber!==c.job.currentWaveNumber+1||!Array.isArray(r.excludeDriverIds)||!r.excludeDriverIds.every(quoteEntityIdValid))return fail10();
 }
 if(c.cycle.engine==='FINANCIAL'&&c.order.financialRelease){
 if(time3>=ms(c.job.expiresAt))decision={action:'REVIEW',reason:'SEARCH_DEADLINE'};
 else if(decision.action==='START_WAVE')decision={...decision,deadline:iso(Math.min(ms(decision.deadline),ms(c.job.expiresAt)))};
 }''')
 if tag=='timeout':
  replace('runHostedFinancialTick: () => runHostedFinancialTick,','resumeHostedFinancialUnassignment: () => resumeHostedFinancialUnassignment,\n  runHostedFinancialTick: () => runHostedFinancialTick,')
  v+='''\nasync function resumeHostedFinancialUnassignment(orderId,invokeStart){hostedFinancialScope();const enableDeliveryFunding=deliveryFundingCapability();return createStagingDispatchFinancialHost({db:hostDB(),enableDeliveryFunding,enableFullCash:process.env.FINANCIAL_SETTLEMENT_MODEL==='FULL_CASH_AT_DELIVERY_V1',start:invokeStart}).processOrder(orderId);}\n'''
 candidate=p/(tag+'-runtime.js');candidate.write_text(v);subprocess.run(['node','--check',str(candidate)],check=True)
 changes={'dispatch-cycle-runtime.js':candidate.read_bytes()}
 if tag=='timeout':
  idx=(p/tag/'index.js').read_text();src=(root/'lambda/WaveSystem_HandleWaveTimeout/index.js').read_text();begin="    if (financialJob?.financialRedispatch &&";end="    if (financialJob && Object.prototype.hasOwnProperty.call(financialJob,'dispatchCycle')) {";assert idx.count(end)==1
  idx=idx.replace(end,src[src.index(begin):src.index(end)]+end);path=p/'timeout-index.js';path.write_text(idx);subprocess.run(['node','--check',str(path)],check=True);changes['index.js']=path.read_bytes()
 config=json.loads((p/(tag+'-config.json')).read_text());current=client.get_function_configuration(FunctionName=name);assert current['CodeSha256'] in [config['CodeSha256']]+[x['after']for x in prior['functions']if x['name']==name],'LIVE_DRIFT'
 raw=(p/(tag+'.zip')).read_bytes();assert sha(raw)==config['CodeSha256']
 with zipfile.ZipFile(p/(tag+'.zip'))as z:
  with zipfile.ZipFile(p/(tag+'-254.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for i in z.infolist():out.writestr(copy.copy(i),changes.get(i.filename,z.read(i.filename)))
  with zipfile.ZipFile(p/(tag+'-254.zip'))as out:assert all(z.read(n)==out.read(n)for n in z.namelist()if n not in changes)
 code=(p/(tag+'-254.zip')).read_bytes();client.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=code)
 for _ in range(50):
  after=client.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(1)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(code)
 for key in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig']:assert after.get(key)==current.get(key)
 report['functions'].append({'name':name,'before':current['CodeSha256'],'after':after['CodeSha256'],'changedFiles':list(changes),'unrelatedEntriesIdentical':True});(root/'docs/redispatch-publication-254.json').write_text(json.dumps(report,indent=2)+'\n');print('PUBLISHED',name,flush=True)
