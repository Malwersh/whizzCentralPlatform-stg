"""Build surgical overlays from fresh deployed Staging bundles. No publication."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,subprocess
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance93')
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def once(s,a,b):
 assert s.count(a)==1,('OVERLAY_DRIFT',a[:120]);return s.replace(a,b)
def main():
 l=m.session().client('lambda');inventory={}
 for key,name in [('wave','WaveSystem_StartWave'),('timeout','WaveSystem_HandleWaveTimeout')]:
  f=l.get_function(FunctionName=name);inventory[key]=f['Configuration'];p=O/(key+'.config.private.json');p.write_text(json.dumps(f['Configuration'],default=str));p.chmod(0o600);(O/(key+'.base.zip')).write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read())
 subprocess.run(['node','-e',"require('./backend/wallet-service/node_modules/esbuild').buildSync({entryPoints:['lambda/WaveSystem_StartWave/financial-wave-policy.js'],bundle:true,platform:'node',target:'node20',outfile:'/private/tmp/finance93/financial-wave-policy.js'})"],cwd=R,check=True)
 for key in ['wave','timeout']:
  with zipfile.ZipFile(O/(key+'.base.zip')) as z:
   s=z.read('index.js').decode();changes={}
   if key=='timeout':
    needle='    if (financialJob?.financialDispatch === true) {'
    addition="""
      const scopes=require('./finance-rollout').readFinanceRollout().scopes;
      if(!scopes.some(scope=>scope.orders.some(o=>o.orderId===orderId&&o.branchId===financialJob.restaurantId))){result.skipped='OUT_OF_FINANCIAL_SCOPE';return result;}
      const source=await dynamodb.get({TableName:'WizzOrders',Key:{PK:'ORDER#'+orderId,SK:'META'},ConsistentRead:true,ProjectionExpression:'orderId'}).promise();
      if(!source.Item){result.skipped='CANONICAL_ORDER_MISSING';return result;}
"""
    s=once(s,needle,needle+addition)
    s=once(s,'        await invokeStartWave(financialJob.dispatchJobId,orderId,wave+1,expired.driverIds,[],false,false);\n        result.nextWaveStarted = true;',"""        const policy=await require('./financial-wave-policy').createFinancialWavePolicy({db:dynamodb,jobsTable:DISPATCH_JOBS_TABLE}).read(financialJob,wave+1);
        const started=await invokeStartWave(financialJob.dispatchJobId,orderId,wave+1,policy.permanent,policy.previous,policy.isFinalWave,false);
        if(!started.success)throw Error('FINANCIAL_NEXT_WAVE_PENDING');
        result.nextWaveStarted = true;""")
   else:
    s=once(s,'    const waveThresholds = getWaveThresholds(waveNumber, isEmergencyWave);',"    const financialPolicy=dispatchJob.financialDispatch===true?await require('./financial-wave-policy').createFinancialWavePolicy({db:dynamodb,jobsTable:DISPATCH_JOBS_TABLE}).read(dispatchJob,waveNumber):null;\n    const waveThresholds = financialPolicy?.thresholds ?? getWaveThresholds(waveNumber, isEmergencyWave);")
    s=once(s,'    let qualifiedDrivers = await getQualifiedDrivers(dispatchJob, excludeDriverIds, excludeDriverIds, rejectedDriverIds, isFinalWave, isEmergencyWave, waveNumber, waveThresholds);','    let qualifiedDrivers = await getQualifiedDrivers(dispatchJob, financialPolicy?.permanent ?? excludeDriverIds, financialPolicy?.permanent ?? excludeDriverIds, financialPolicy?.previous ?? rejectedDriverIds, financialPolicy?.isFinalWave ?? isFinalWave, isEmergencyWave, waveNumber, waveThresholds);')
    s=once(s,'qualifiedDrivers.slice(0,Math.min(25,WAVE_SIZE)).map(d=>d.driverId),waveNumber)',"qualifiedDrivers.slice(0,financialPolicy.recipients==='ALL'?25:financialPolicy.recipients).map(d=>d.driverId),waveNumber,financialPolicy.operating)")
    s=once(s,'async function runFinancialDispatch(dispatchJob,driverIds,waveNumber) {','async function runFinancialDispatch(dispatchJob,driverIds,waveNumber,selectionPolicy) {')
    s=once(s,'  });\n  // Persist the actual offer deadline;','  },selectionPolicy);\n  // Persist the actual offer deadline;')
    r=z.read('financial-runtime.js').decode();r=once(r,'async function runFinancialWave(input, sendOffer) {','async function runFinancialWave(input, sendOffer, selectionPolicy) {')
    old="    const operating = savedWave ? { ...(savedWave.operatingLimits ? validateOperationsSnapshot(savedWave.operatingLimits) : await readDeliveryOperations(db, { ...process.env, DELIVERY_OPERATIONS_MODE: 'ENV' })), condition: null } : await readDeliveryOperations(db);"
    new="    const priorPolicy = selector.waveNumber > 1 ? await strongGet(db, 'WizzDispatchJobs_staging', {orderId:selector.orderId, SK:'FINANCIAL_WAVE#1'}) : null;\n"+old.replace(' : await readDeliveryOperations(db);',' : priorPolicy?.operatingLimits ? {...validateOperationsSnapshot(priorPolicy.operatingLimits),condition:null} : await readDeliveryOperations(db);')+"\n    if(selectionPolicy&&(selectionPolicy.version!==operating.version||JSON.stringify(selectionPolicy.values)!==JSON.stringify(operating.values)))throw Error('FINANCIAL_SELECTION_POLICY_CHANGED');"
    r=once(r,old,new);changes['financial-runtime.js']=r.encode()
   changes['index.js']=s.encode();changes['financial-wave-policy.js']=(O/'financial-wave-policy.js').read_bytes()
   with zipfile.ZipFile(O/(key+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
    for item in z.infolist():out.writestr(copy.copy(item),changes.get(item.filename,z.read(item.filename)))
    for name,data in changes.items():
     if name not in z.namelist():out.writestr(name,data)
   for name,data in changes.items():
    p=O/(key+'.'+name);p.write_bytes(data);subprocess.run(['node','--check',str(p)],check=True)
   with zipfile.ZipFile(O/(key+'.candidate.zip')) as out:assert all(z.read(n)==out.read(n) for n in z.namelist() if n not in changes)
 p=O/'inventory.private.json';p.write_text(json.dumps(inventory,default=str));p.chmod(0o600);print(json.dumps({'prepared':True,'functions':2,'published':False}))
if __name__=='__main__':main()
