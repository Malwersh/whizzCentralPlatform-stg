"""Publish and enable tested general staff-requested financial search recovery, staging only."""
import sys,pathlib,json,zipfile,copy,hashlib,base64,time,subprocess
sys.path.insert(0,'/private/tmp/full-cash-208')
from aws_session import session
root=pathlib.Path(__file__).resolve().parents[1];p=root/'backend/.tmp/order-exceptions-work/review-237';s=session();l=s.client('lambda');sha=lambda b:base64.b64encode(hashlib.sha256(b).digest()).decode()
for name in ['wallet-tests-238','captured-tests-238']:assert 'ℹ fail 0'in(p/(name+'.log')).read_text()
report={'part':238,'status':'PUBLISHING','scope':'STAGING_GENERAL_RECORDED_FINANCIAL_INITIAL_RETRY','functions':[],'iamChanges':False,'walletOrLedgerWritesByAgent':False,'manualOrderReset':False};doc=root/'docs/dispatch-retry-general-publication-238.json'
changesets=[('timeout','WaveSystem_HandleWaveTimeout',{'dispatch-cycle-runtime.js':p/'timeout-candidate.js','dispatch-restart-funding-238.js':p/'dispatch-restart-funding-238.js'}),('worker','staging-cod-integration',{'index.js':p/'worker-candidate.js','dispatch-review-host-238.js':p/'dispatch-review-host-238.js'})]
for label,name,changes in changesets:
 before=json.loads((p/(label+'-config.private.json')).read_text());current=l.get_function_configuration(FunctionName=name);assert current['CodeSha256']==before['CodeSha256'],'LIVE_CODE_DRIFT '+name
 for file in changes.values():subprocess.run(['node','--check',str(file)],check=True)
 with zipfile.ZipFile(p/(label+'-base.zip'))as old:
  assert sha((p/(label+'-base.zip')).read_bytes())==before['CodeSha256']
  with zipfile.ZipFile(p/(label+'-238.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes[info.filename].read_bytes()if info.filename in changes else old.read(info.filename))
   for file,path in changes.items():
    if file not in old.namelist():out.writestr(file,path.read_bytes())
  with zipfile.ZipFile(p/(label+'-238.zip'))as out:assert all(old.read(n)==out.read(n)for n in old.namelist()if n not in changes)
 raw=(p/(label+'-238.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=raw,Publish=False)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=name)
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha(raw)
 for k in ['Environment','Role','Handler','Runtime','Timeout','MemorySize','Architectures','VpcConfig','EphemeralStorage']:assert current.get(k)==after.get(k),'CONFIG_DRIFT '+k
 report['functions'].append({'name':name,'baseCodeSha256':before['CodeSha256'],'codeSha256':sha(raw),'changedFiles':list(changes),'otherZipEntriesIdentical':True,'configurationPreservedDuringCodeUpdate':True});doc.write_text(json.dumps(report,indent=2)+'\n');print('Published '+name,flush=True)
# Existing scheduled worker and IAM only; enabling recorded RETRY_SEARCH never funds or cancels an order.
name='staging-cod-integration';current=l.get_function_configuration(FunctionName=name);env=current['Environment']['Variables'];assert env.get('FINANCE_GENERAL_RELEASE_MODE')=='REQUIRED'and env.get('FINANCIAL_SETTLEMENT_MODEL')=='FULL_CASH_AT_DELIVERY_V1';assert env.get('DISPATCH_REVIEW_EXECUTION_MODE')=='OFF'
rule=env['DISPATCH_REVIEW_HOST_RULE_ARN'];events=s.client('events');binding=events.describe_rule(Name=rule.rsplit('/',1)[1]);assert binding['State']=='ENABLED'and binding['ScheduleExpression']=='rate(1 minute)';assert any(t['Arn'].endswith(':function:'+name)for t in events.list_targets_by_rule(Rule=binding['Name'])['Targets'])
nextenv={**env,'DISPATCH_REVIEW_EXECUTION_MODE':'SAFE_FINANCIAL_INITIAL_RETRY'};l.update_function_configuration(FunctionName=name,RevisionId=current['RevisionId'],Environment={'Variables':nextenv})
for _ in range(60):
 after=l.get_function_configuration(FunctionName=name)
 if after['LastUpdateStatus']!='InProgress':break
 time.sleep(2)
assert after['LastUpdateStatus']=='Successful'and after['Environment']['Variables']==nextenv and after['CodeSha256']==current['CodeSha256']
report.update({'status':'PUBLISHED_AND_ACTIVE','onlyEnvironmentChange':{'function':name,'key':'DISPATCH_REVIEW_EXECUTION_MODE','before':'OFF','after':'SAFE_FINANCIAL_INITIAL_RETRY'},'existingSchedulePreserved':True,'tests':{'wallet':1209,'capturedHosts':20,'failed':0}});doc.write_text(json.dumps(report,indent=2)+'\n');print('Activated general recorded initial financial retry on existing schedule.',flush=True)
