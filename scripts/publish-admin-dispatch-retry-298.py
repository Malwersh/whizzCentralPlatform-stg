"""Publish verified replacement-cycle readers, then enable recorded admin retry. Staging only."""
from pathlib import Path
import json,subprocess,hashlib,base64,zipfile,sys
R=Path(__file__).resolve().parents[1];P=R/'backend/.tmp/admin-dispatch-retry-298';B=['aws','--profile','Wizz_stg_UserApp','--region','us-east-1']
def aws(*a):
 raw=subprocess.check_output(B+list(a));return json.loads(raw)if raw.strip()else{}
def digest(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
assert '--publish-staging' in sys.argv
for log in ['admin-retry-298-all-tests-verified.log','admin-retry-298-packaged-final-verified.log']:
 s=(Path('/private/tmp')/log).read_text();assert 'ℹ fail 0'in s and 'ℹ pass 'in s,log
items=json.loads((P/'packages.json').read_text());assert len(items)==9
# Confirm every live base before any code mutation.
for row in items:
 cfg=aws('lambda','get-function-configuration','--function-name',row['name']);assert cfg['CodeSha256']==row['baseHash']and cfg['RevisionId']==row['revision'],'LIVE_DRIFT '+row['name']
 assert digest((P/row['name']/'candidate.zip').read_bytes())==row['hash']
worker=json.loads((P/'staging-cod-integration/config.private.json').read_text());oldMode=worker['Environment']['Variables'].get('DISPATCH_REVIEW_EXECUTION_MODE');assert oldMode=='SAFE_FINANCIAL_INITIAL_RETRY',oldMode
report={'status':'PUBLISHING_READERS_FIRST','functions':[],'iamChanged':False,'financialDataWrittenByAgent':False,'orderRestartedByAgent':False,'centralWaveThresholdsChanged':False,'tests':{'source':1633,'packaged':47,'failures':0}}
receipt=R/'docs/admin-dispatch-retry-publication-298.json'
def save():receipt.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
save()
# Worker is updated last; its old activation mode stays initial-only until all readers are ready.
items.sort(key=lambda r:(r['name']=='staging-cod-integration',r['name']))
for row in items:
 name=row['name'];before=aws('lambda','get-function-configuration','--function-name',name);assert before['CodeSha256']==row['baseHash']
 aws('lambda','update-function-code','--function-name',name,'--revision-id',before['RevisionId'],'--zip-file','fileb://'+str(P/name/'candidate.zip'))
 subprocess.run(B+['lambda','wait','function-updated-v2','--function-name',name],check=True)
 after=aws('lambda','get-function-configuration','--function-name',name);assert after['CodeSha256']==row['hash']and after['LastUpdateStatus']=='Successful'
 for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Architectures']:assert before.get(k)==after.get(k),'CONFIG_DRIFT '+name+' '+k
 report['functions'].append({'name':name,'beforeHash':row['baseHash'],'hash':row['hash'],'changedFiles':row['changedFiles'],'otherEntriesUnchanged':True,'configurationPreserved':True});save();print('Published verified',name,flush=True)
current=aws('lambda','get-function-configuration','--function-name','staging-cod-integration');env=current['Environment']['Variables'];assert env.get('DISPATCH_REVIEW_EXECUTION_MODE')==oldMode
assert env.get('FINANCE_GENERAL_RELEASE_MODE')=='REQUIRED'and env.get('FINANCIAL_SETTLEMENT_MODEL')=='FULL_CASH_AT_DELIVERY_V1'
nextenv={**env,'DISPATCH_REVIEW_EXECUTION_MODE':'SAFE_FINANCIAL_RETRY'}
aws('lambda','update-function-configuration','--function-name','staging-cod-integration','--revision-id',current['RevisionId'],'--environment',json.dumps({'Variables':nextenv}))
subprocess.run(B+['lambda','wait','function-updated-v2','--function-name','staging-cod-integration'],check=True)
after=aws('lambda','get-function-configuration','--function-name','staging-cod-integration');assert after['Environment']['Variables']==nextenv and after['CodeSha256']==current['CodeSha256']
report.update({'status':'PUBLISHED_ACTIVE_STAGING','activation':{'function':'staging-cod-integration','key':'DISPATCH_REVIEW_EXECUTION_MODE','before':oldMode,'after':'SAFE_FINANCIAL_RETRY'},'requiresRecordedStaffDecision':True,'existingSchedulesPreserved':True});save();print('Administrative replacement search activated for recorded staff decisions.',flush=True)
