"""Local-only preparation from already captured Lambda packages. No AWS writes."""
from pathlib import Path
import zipfile,json,copy,hashlib,base64,re,subprocess
R=Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=Path('/private/tmp/driver-performance-projection-291')
def digest(p):return base64.b64encode(hashlib.sha256(p.read_bytes()).digest()).decode()
reports=[]
for name in ['DriversApi-staging','staging-wizz-staff-service','WaveSystem_StartWave','WaveSystem_HandleWaveTimeout','WaveSystem_CreateDispatchJob']:
 q=P/name;cfg=json.loads((q/'config.private.json').read_text());assert digest(q/'base.zip')==cfg['CodeSha256'];z=zipfile.ZipFile(q/'base.zip');changes={}
 if name=='DriversApi-staging':
  n='lambda_driver_api_v2.js';s=z.read(n).decode();needle="      const result = await require('./driver-performance').readPerformance(";assert s.count(needle)==1
  source=(D/'backend'/n).read_text();a=source.index("      if(process.env.DRIVER_PERFORMANCE_SNAPSHOT_READS_ENABLED");b=source.index(needle,a);s=s.replace(needle,source[a:b]+needle)
  needle='async function getDriverMetrics(driverId, corsHeaders) {\n  try {';assert s.count(needle)==1;a=source.index(needle)+len(needle);b=source.index('\n    console.log',a);s=s.replace(needle,needle+source[a:b])
  a=s.index('async function getDriverProfile(username,');b=s.index('async function createDriverProfile(',a);sa=source.index('async function getDriverProfile(username,');sb=source.index('async function createDriverProfile(',sa)
  # Only the small profile getter changes; profile creation/update and all other API handlers remain byte-identical.
  s=s[:a]+source[sa:sb]+s[b:]
  changes[n]=s.encode()
 elif name=='staging-wizz-staff-service':
  n='_discount_review/central-staff/index.js';s=z.read(n).decode();a=s.index('// backend/staff-service/drivers.js');b=s.index('\n// backend/',a+10);block=s[a:b]
  needle='if (method === "GET" && path === "/staff/drivers/regions")';assert block.count(needle)==1
  add="if(method==='GET'&&/^\\/staff\\/drivers\\/([A-Za-z0-9_.:-]+)\\/performance$/.test(path))return require('../../driver-performance-admin-291.js').read({db:ctx.db,GetCommand:GetCommand2,driverId:path.split('/')[3],driversTable:ctx.driversTable,inScope:profile=>inScope(actor,profile)});\n      "
  block=block.replace(needle,add+needle);s=s[:a]+block+s[b:];changes[n]=s.encode();changes['driver-performance-admin-291.js']=(R/'backend/driver-performance-projection/admin-reader.js').read_text().replace("require('./contract')","require('./driver-performance-snapshot')").encode()
  a=s.index('// backend/staff-service/dispatch-settings.js');b=s.index('\n// backend/',a+10);block=s[a:b]
  needle='if (approve && current?.values?.dispatch && !change?.values?.dispatch)';assert block.count(needle)==1
  block=block.replace(needle,"await require('../../driver-performance-policy-guard-291.js').assertCutoverReady({db:ctx.db,GetCommand:GetCommand2,values:request?input?.values:change?.values});\n        "+needle)
  s=s[:a]+block+s[b:];changes[n]=s.encode();changes['driver-performance-policy-guard-291.js']=(R/'backend/driver-performance-projection/policy-guard.js').read_text().replace("require('./contract')","require('./driver-performance-snapshot')").encode()
 elif name=='WaveSystem_CreateDispatchJob':
  n='index.js';s=z.read(n).decode();assert "const dispatchWithoutActivity = exports.handler"in s
  s+="\nconst dispatchBeforePerformance291=exports.handler;exports.handler=async(event,context)=>{if(process.env.DRIVER_PERFORMANCE_FORWARD_ENABLED==='true'&&Array.isArray(event?.Records))await require('./driver-performance-order-forwarder-291.js').forwardOrderEvents(event,input=>lambda.invoke(input).promise());return dispatchBeforePerformance291(event,context);};\n"
  changes[n]=s.encode();changes['driver-performance-order-forwarder-291.js']=(R/'backend/driver-performance-projection/order-forwarder.js').read_bytes()
 else:
  n='dispatch-cycle-runtime.js';s=z.read(n).decode();a=s.index('function createStagingDispatchCandidates(options)');b=s.index('\n// backend/',a);block=s[a:b]
  needle='  const previouslyOffered = /* @__PURE__ */ new Set();';assert block.count(needle)==1
  add="""  const projection291=require('./driver-performance-snapshot.js'),configured291=options.performanceMode??process.env.DISPATCH_DRIVER_PERFORMANCE_MODE??'OFF',captured291=c.policy.values.dispatch.performanceMode;
  if(!['OFF','SHADOW','ENFORCE'].includes(configured291)||captured291==='VERIFIED_SNAPSHOT_V1'&&configured291!=='ENFORCE')throw Error('DISPATCH_PERFORMANCE_REFRESH_PENDING');
  const mode291=configured291;
  const pending291=new Set();const shadow291={checked:0,current:0,different:0,pending:0};
  const health291=mode291==='OFF'?null:await strongGet(db,projection291.TABLE,{pk:'CONTROL',sk:'HEALTH'});
"""
  block=block.replace(needle,add+needle)
  needle='      if (["metricsSnapshot_acceptanceRate",';assert block.count(needle)==1
  add="""      if(mode291!=='OFF'){const row291=await strongGet(db,projection291.TABLE,{pk:'DRIVER#'+driverId,sk:'STATE'}),metrics291=projection291.dispatchMetrics(row291,health291,now(),profile.newDriverExemption.belowCompletedTrips);shadow291.checked++;if(metrics291){shadow291.current++;if(['metricsSnapshot_acceptanceRate','metricsSnapshot_completionRate','metricsSnapshot_consecutiveRejections','metricsSnapshot_totalTrips'].some(k=>state[k]!==metrics291[k]))shadow291.different++;}else shadow291.pending++;if(mode291==='ENFORCE'){if(!metrics291){pending291.add(driverId);continue;}Object.assign(state,metrics291);}}
"""
  block=block.replace(needle,add+needle);needle='return candidates.slice(';assert block.count(needle)==1;block=block.replace(needle,"if(mode291==='ENFORCE'&&!candidates.length&&pending291.size)throw Error('DISPATCH_PERFORMANCE_REFRESH_PENDING');\n    if(mode291==='SHADOW')console.info('DRIVER_PERFORMANCE_SHADOW',shadow291);\n    "+needle);s=s[:a]+block+s[b:]
  # The captured validator accepts the explicit new policy mode; no mode is enabled by packaging.
  needle='root.performanceMode !== "LEGACY_METRICS"';assert s.count(needle)==1;s=s.replace(needle,'!["LEGACY_METRICS","VERIFIED_SNAPSHOT_V1"].includes(root.performanceMode)')
  changes[n]=s.encode()
 # Broaden only the explicit performance-source enum in existing application validators.
 for filename in z.namelist():
  if not filename.endswith('.js')or'node_modules/'in filename or'@aws-sdk/'in filename:continue
  body=changes.get(filename,z.read(filename)).decode(errors='strict')
  updated,count=re.subn(r'\b(\w+)\.performanceMode\s*!==\s*[\'\"]LEGACY_METRICS[\'\"]',lambda m:'!["LEGACY_METRICS","VERIFIED_SNAPSHOT_V1"].includes('+m.group(1)+'.performanceMode)',body)
  if count:changes[filename]=updated.encode()
 if name!='WaveSystem_CreateDispatchJob':changes['driver-performance-snapshot.js']=(R/'backend/driver-performance-projection/contract.js').read_bytes()
 candidate=q/'candidate.zip'
 with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED)as out:
  for info in z.infolist():out.writestr(copy.copy(info),changes.get(info.filename,z.read(info.filename)))
  for n,data in changes.items():
   if n not in z.namelist():out.writestr(n,data)
 new=zipfile.ZipFile(candidate);assert all(new.read(n)==z.read(n)for n in z.namelist()if n not in changes)
 for n,data in changes.items():
  f=q/('check-'+n.replace('/','_'));f.write_bytes(data);subprocess.run(['node','--check',str(f)],check=True)
 reports.append({'function':name,'baseHash':cfg['CodeSha256'],'revision':cfg['RevisionId'],'candidateHash':digest(candidate),'changedFiles':list(changes),'roleArn':cfg['Role'],'configurationChanged':False,'deployed':False})
(R/'docs/driver-performance-projection-packages-291.json').write_text(json.dumps({'status':'PREPARED_NOT_DEPLOYED','functions':reports,'activation':'OFF_UNTIL_INFRASTRUCTURE_APPROVAL_BACKFILL_AND_PARITY'},indent=2)+'\n');print(json.dumps([{'function':r['function'],'files':r['changedFiles']}for r in reports],indent=2))
