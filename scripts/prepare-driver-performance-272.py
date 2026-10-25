import pathlib,zipfile,copy,json,subprocess,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];D=R.parent/'whizzDrivers-stg';P=pathlib.Path('/private/tmp/driver-performance-272');records=[]
subprocess.run(['node','-e',"const e=require('./backend/wallet-service/node_modules/esbuild'),f=require('fs');f.writeFileSync('/private/tmp/driver-performance-272/driver-performance-decision-runtime-272.js',e.buildSync({entryPoints:['backend/wallet-service/src/driverPerformanceDecision.ts'],bundle:true,platform:'node',target:'node22',write:false,external:['@aws-sdk/*']}).outputFiles[0].contents)"],cwd=R,check=True)
wrapper=b'''\n// Driver performance272: operational attribution independent of financial decisions.\nmodule.exports=((previous,runtime)=>({...previous,createExceptionCaseAdministration:options=>{const original=previous.createExceptionCaseAdministration(options),performance=runtime.createDriverPerformanceDecision(options);return value=>value?.action==="SET_DRIVER_PERFORMANCE"?performance(value):original(value);}}))(module.exports,require("./driver-performance-decision-runtime-272.js"));\n'''
for label in ['driver','financial','staff']:
 old=zipfile.ZipFile(P/(label+'-base.zip'));changes={}
 if label=='driver':
  s=old.read('lambda_driver_api_v2.js').decode();source=(D/'backend/lambda_driver_api_v2.js').read_text();a=source.index("    if ((path === '/driver/offers/displayed'");b=source.index("    if ((path === '/driver/performance'",a);anchor="    if ((path === '/driver/performance'";assert s.count(anchor)==1 and '/driver/offers/displayed' not in s
  s=s.replace(anchor,source[a:b]+anchor,1);needle='ScanCommand, QueryCommand, DeleteCommand }';assert s.count(needle)==1;s=s.replace(needle,'ScanCommand, QueryCommand, DeleteCommand, TransactWriteCommand }',1)
  a=s.index("    if ((path === '/driver/performance'");b=s.index('    // 📊 NEW: Get driver performance metrics',a);sa=source.index("    if ((path === '/driver/performance'");sb=source.index('    // 📊 NEW: Get driver performance metrics',sa);s=s[:a]+source[sa:sb]+s[b:]
  changes={'lambda_driver_api_v2.js':s.encode(),'driver-performance.js':(D/'backend/driver-performance.js').read_bytes(),'driver-offer-display-receipt.js':(D/'backend/driver-offer-display-receipt.js').read_bytes()}
 elif label=='financial':
  raw=old.read('order-exception-runtime-229.js');assert b'Driver performance272' not in raw;changes['order-exception-runtime-229.js']=raw+wrapper;changes['driver-performance-decision-runtime-272.js']=(P/'driver-performance-decision-runtime-272.js').read_bytes()
  s=old.read('staff-order-management-runtime.js').decode();i=s.index('kind: "COD_ASSIGNMENT_RELEASE"');j=s.index('orderId: v5.orderId,',i);part=s[i:j];needle='          actorKind: kind,\n';assert part.count(needle)==1;part=part.replace(needle,needle+'          ...!cancel && kind === "DRIVER" ? {driverReportedReason:v5.reason,reasonSchemaVersion:1} : {},\n',1);changes['staff-order-management-runtime.js']=(s[:i]+part+s[j:]).encode()
 else:
  s=old.read('order-exception-cases.js').decode()
  for needle,replacement in [
   ('activeResponsibilityFindingId:row.activeResponsibilityFindingId||null,','activeResponsibilityFindingId:row.activeResponsibilityFindingId||null,driverPerformanceDecisions:row.driverPerformanceDecisions||[],'),
   ('  const events=[];let cursor,pages=0;','  const events=[],performanceAssignments=[];let cursor,pages=0;'),
   ('events.push(...(r.Items||[]).filter',"for(const a of r.Items||[])if(a.kind==='COD_ASSIGNMENT_RELEASE'&&a.orderId===c.order.orderId&&typeof a.driverId==='string'&&typeof a.offerId==='string'&&Number.isSafeInteger(a.attempt))performanceAssignments.push({driverId:a.driverId,offerId:a.offerId,attempt:a.attempt,outcome:a.outcome,reportedReason:a.driverReportedReason||null});events.push(...(r.Items||[]).filter"),
   ("'ORDER_EXCEPTION_FINDING'].includes(x.kind)","'ORDER_EXCEPTION_FINDING','DRIVER_PERFORMANCE_DECISION_EVENT'].includes(x.kind)"),
   ('  if(financial&&c.row.entitlementsPosted',"  if(c.order.driverId&&c.order.financialAcceptance?.offerId&&Number.isSafeInteger(c.order.assignmentAttemptCounter)&&['cancelled','canceled','returned'].includes(c.order.status)&&!performanceAssignments.some(a=>a.offerId===c.order.financialAcceptance.offerId))performanceAssignments.push({driverId:c.order.driverId,offerId:c.order.financialAcceptance.offerId,attempt:c.order.assignmentAttemptCounter,outcome:c.order.status.toUpperCase(),reportedReason:null});\n  item.performanceAssignments=performanceAssignments;\n  if(financial&&c.row.entitlementsPosted"),
   ('"noAutomaticCharge","plan"]','"noAutomaticCharge","plan","driverId","offerId","attempt","decisionId","decision","supersedesDecisionId"]')]:
   assert s.count(needle)==1,(label,needle);s=s.replace(needle,replacement,1)
  changes['order-exception-cases.js']=s.encode()
 with zipfile.ZipFile(P/(label+'-candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
  for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
  for name,value in changes.items():
   if name not in old.namelist():out.writestr(name,value)
 new=zipfile.ZipFile(P/(label+'-candidate.zip'));assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes)
 for name,value in changes.items():
  if name.endswith('.js'):
   check=P/'syntax.js';check.write_bytes(value);subprocess.run(['node','--check',str(check)],check=True)
 c=json.loads((P/(label+'-config.private.json')).read_text());records.append({'label':label,'function':c['FunctionName'],'before':c['CodeSha256'],'revision':c['RevisionId'],'candidate':base64.b64encode(hashlib.sha256((P/(label+'-candidate.zip')).read_bytes()).digest()).decode(),'changedFiles':list(changes),'allOtherEntriesIdentical':True})
(P/'packages.json').write_text(json.dumps(records,indent=2));(R/'docs/driver-performance-packages-272.json').write_text(json.dumps({'status':'PREPARED_NOT_PUBLISHED','functions':records,'businessWrites':0,'financialPolicyChanged':False},indent=2)+'\n')
policy={'Version':'2012-10-17','Statement':[{'Effect':'Allow','Action':['dynamodb:Query','dynamodb:PutItem','dynamodb:ConditionCheckItem'],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/WaveOffers_staging'}]}
(R/'docs/driver-offer-receipt-policy-272.json').write_text(json.dumps(policy,indent=2)+'\n')
print(json.dumps([{'function':r['function'],'files':r['changedFiles']}for r in records]))
