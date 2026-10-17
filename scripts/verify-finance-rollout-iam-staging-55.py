"""Actual bounded order-identity read/fence probes under the four published roles.
Creates four temporary non-HTTP Lambdas and one synthetic metadata row;
never writes funds, legitimate orders or people. All test resources are cleaned.
"""
import argparse,base64,datetime,hashlib,io,json,subprocess,time,uuid,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];ACCOUNT='699561669180';REGION='us-east-1'
def run(output):
 import boto3
 out=Path(output);out.mkdir(mode=0o700,exist_ok=True)
 session=boto3.Session(profile_name='Wizz_stg_UserApp',region_name=REGION)
 if session.client('sts').get_caller_identity()['Account']!=ACCOUNT:raise ValueError('STAGING_ACCOUNT_REQUIRED')
 lam=session.client('lambda');ddb=session.resource('dynamodb');logs=session.client('logs')
 manifest=json.loads((out/'verification.json').read_text());refs={r['name']:r for r in manifest['functions']}
 # The deployed bundle, not a different local guard build, is exercised below.
 f=lam.get_function(FunctionName='staging-driver-financial-accept');cfg=f['Configuration']
 if cfg['CodeSha256']!=refs['staging-driver-financial-accept']['codeSha256']:raise ValueError('PUBLISHED_FINANCIAL_CODE_DRIFT')
 data=urllib.request.urlopen(f['Code']['Location'],timeout=60).read()
 if base64.b64encode(hashlib.sha256(data).digest()).decode()!=cfg['CodeSha256']:raise ValueError('PUBLISHED_ARCHIVE_MISMATCH')
 publishedZip=zipfile.ZipFile(io.BytesIO(data));guard=publishedZip.read('finance-rollout.js')
 (out/'published-financial-index.js').write_bytes(publishedZip.read('index.js'));(out/'published-finance-rollout.js').write_bytes(guard)
 entry=out/'probe-index.js'
 subprocess.run(['node','-e',"const fs=require('fs'),p=require('path'),es=require('./backend/wallet-service/node_modules/esbuild');fs.writeFileSync(process.argv[1],es.buildSync({entryPoints:['scripts/finance-rollout-iam-probe-55.cjs'],nodePaths:[p.resolve('backend/wallet-service/node_modules')],bundle:true,platform:'node',target:'node22',external:['./finance-rollout'],write:false,logLevel:'silent'}).outputFiles[0].contents,{mode:0o600});",str(entry)],cwd=ROOT,check=True)
 nonce=uuid.uuid4().hex;orderid='finance55-probe-'+nonce;branch='finance55-branch-'+nonce;subject='finance55-subject-'+nonce;driver='finance55-driver-'+nonce
 scope={'id':'finance55-verification-'+nonce,'version':1,'mode':'SCOPED','admitUntil':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).isoformat(timespec='milliseconds').replace('+00:00','Z'),'orders':[{'orderId':orderid,'branchId':branch,'customerSubjectId':subject}],'drivers':[{'driverId':driver,'subjectId':driver}]}
 canon=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
 sha=lambda v:hashlib.sha256(canon(v).encode()).hexdigest()
 config={'schemaVersion':1,'accountId':ACCOUNT,'region':REGION,'scopes':[scope]}
 row={'PK':'ORDER#'+orderid,'SK':'META','orderId':orderid,'userSub':subject,'storeId':branch,'status':'FINANCE_SCOPE_PROBE','createdBy':'SYSTEM_FINANCE55_PROBE','financeRollout':{'schemaVersion':1,'scopeId':scope['id'],'version':1,'digest':sha({k:scope[k] for k in ['id','version','orders','drivers']})}}
 key={k:row[k] for k in ['PK','SK']};table=ddb.Table('WizzOrders');created=False;functions=[];report={'account':ACCOUNT,'region':REGION,'syntheticOrderId':orderid,'syntheticRowOnly':True,'humanRowsRead':False,'financialWrites':0,'providerCallsFromProbe':0,'liveGatesChanged':False,'cohortOnApplicationFunctionsChanged':False,'checks':[],'cleanup':{}}
 save=lambda:(out/'actual-iam-probes.json').write_text(json.dumps(report,indent=2)+'\n')
 try:
  table.put_item(Item=row,ConditionExpression='attribute_not_exists(PK)');created=True
  payload=io.BytesIO()
  with zipfile.ZipFile(payload,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.js',entry.read_bytes());z.writestr('finance-rollout.js',guard)
  targets=[('writer','WizzUser-CreateOrder-staging'),('staff','staging-wizz-staff-service'),('notice','staging-wizz-wallet-notification-worker'),('push','wizzcentral-notifications-staging-pushSendWaveOffer')]
  for label,target in targets:
   source=lam.get_function_configuration(FunctionName=target)
   if source['CodeSha256']!=refs[target]['codeSha256']:raise ValueError('TARGET_CODE_DRIFT')
   role=source['Role'];name='finance55-scope-probe-'+label+'-'+nonce[:12]
   lam.create_function(FunctionName=name,Runtime='nodejs22.x',Role=role,Handler='index.handler',Timeout=25,MemorySize=256,Code={'ZipFile':payload.getvalue()},Description='Temporary bounded synthetic scope IAM verification; no public trigger',Environment={'Variables':{'STAGE':'staging','PROBE_ID':nonce,'PROBE_ROLE':label,'FINANCE_ROLLOUT_CONFIG':canon(config),'FINANCE_ROLLOUT_SHA256':sha(config)}})
   functions.append(name);save()
   for attempt in range(60):
    c=lam.get_function_configuration(FunctionName=name)
    if c['State']=='Active':break
    if c['State']=='Failed':raise ValueError('PROBE_CREATE_FAILED')
    time.sleep(1)
   result=lam.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps({'probeId':nonce}).encode());body=json.load(result['Payload'])
   if result.get('FunctionError') or body.get('ok') is not True:
    report['failedProbe']={'name':label,'errorType':body.get('errorType'),'message':str(body.get('errorMessage',''))[:700]};save();raise ValueError('BOUNDED_IAM_PROBE_FAILED')
   report['checks'].append({'sourceFunction':target,'role':role,'probeFunction':name,**body});save()
   print(json.dumps({'role':label,'actualDynamoDBVerified':True}),flush=True)
  remaining=table.get_item(Key=key,ConsistentRead=True)['Item']
  if remaining!=row:raise ValueError('SYNTHETIC_ROW_CHANGED')
  report['rowUnchangedByAllProbes']=True
 finally:
  errors=[]
  for name in functions:
   try:
    lam.delete_function(FunctionName=name)
    try:lam.get_function_configuration(FunctionName=name);raise ValueError('PROBE_STILL_EXISTS')
    except lam.exceptions.ResourceNotFoundException:pass
   except Exception as e:errors.append({'function':name,'error':type(e).__name__})
   try:logs.delete_log_group(logGroupName='/aws/lambda/'+name)
   except logs.exceptions.ResourceNotFoundException:pass
   except Exception as e:errors.append({'logGroup':name,'error':type(e).__name__})
  if created:
   try:table.delete_item(Key=key,ConditionExpression='createdBy=:by AND financeRollout=:pin',ExpressionAttributeValues={':by':row['createdBy'],':pin':row['financeRollout']})
   except Exception as e:errors.append({'rowCleanup':type(e).__name__})
  report['cleanup']={'temporaryFunctionsDeleted':len(functions),'syntheticRowDeleted':created and not table.get_item(Key=key,ConsistentRead=True).get('Item'),'errors':errors};save()
  for p in out.glob('*.json'):p.chmod(0o600)
  if errors:raise ValueError('PROBE_CLEANUP_INCOMPLETE')
 print(json.dumps({'actualRolesVerified':len(report['checks']),'syntheticRowDeleted':report['cleanup']['syntheticRowDeleted'],'temporaryFunctionsDeleted':len(functions),'liveGatesChanged':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('output');a=p.parse_args()
 try:run(a.output)
 except Exception as e:print(type(e).__name__,str(e) if isinstance(e,ValueError) else 'ACTUAL_IAM_PROBE_FAILED');raise SystemExit(1)
