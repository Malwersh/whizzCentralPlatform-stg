"""Disposable writer-role probe; guaranteed-aborted transaction, never committed funding."""
import io,json,pathlib,subprocess,uuid,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance58')
def main():
 import boto3
 from botocore.config import Config
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda',config=Config(read_timeout=60,retries={'total_max_attempts':1}));logs=s.client('logs');ddb=s.client('dynamodb')
 state=json.loads((OUT/'writer-access-verification.json').read_text());ref=state['writer'];c=lam.get_function_configuration(FunctionName=ref['name']);assert c['CodeSha256']==ref['codeSha256'] and c['RevisionId']==ref['revisionId'];assert c['Environment']['Variables'].get('COMMERCIAL_PRICING_MODE','OFF')=='OFF'
 target=OUT/'writer-probe.js';subprocess.run(['node','-e',"const es=require('./backend/wallet-service/node_modules/esbuild'),fs=require('fs');fs.writeFileSync(process.argv[1],es.buildSync({entryPoints:['scripts/commercial-writer-iam-probe-58.cjs'],nodePaths:['backend/wallet-service/node_modules'],bundle:true,platform:'node',target:'node22',write:false,logLevel:'silent'}).outputFiles[0].contents)",str(target)],check=True,cwd=ROOT)
 nonce=uuid.uuid4().hex;identifier='finance58-'+nonce;name='finance58-writer-probe-'+nonce[:12];created=False;report={'environment':'Staging','applicationGatesChanged':False}
 try:
  data=io.BytesIO()
  with zipfile.ZipFile(data,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.js',target.read_bytes())
  lam.create_function(FunctionName=name,Runtime='nodejs22.x',Role=ref['role'],Handler='index.handler',Timeout=40,MemorySize=256,Code={'ZipFile':data.getvalue()},Environment={'Variables':{'STAGE':'staging','PROBE_ID':nonce}},Description='Disposable commercial writer IAM check; contradictory atomic conditions prevent every write');created=True;lam.get_waiter('function_active_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60})
  response=lam.invoke(FunctionName=name,Payload=json.dumps({'probeId':nonce}).encode());result=json.load(response['Payload']);report['probe']=result;assert not response.get('FunctionError') and result.get('ok') is True,'WRITER_PROBE_FAILED'
  keys=[('staging-Holds',{'orderId':{'S':identifier},'sk':{'S':'PROMOTION_FUNDING'}}),('staging-LedgerEntries',{'walletId':{'S':'WALLET#PLATFORM'},'sk':{'S':'PROBE58#'+identifier}}),('staging-DeliveryQuotes',{'pk':{'S':'CUSTOMER#'+identifier},'sk':{'S':'QUOTE#'+identifier}})]
  schema=ddb.describe_table(TableName='staging-AuditLog')['Table']['KeySchema'];audit={'logId':{'S':'PROMO#'+identifier},'datePartition':{'S':'SYNTHETIC58#'+identifier},'sk':{'S':'PROBE58#'+identifier}};keys.append(('staging-AuditLog',{x['AttributeName']:audit[x['AttributeName']] for x in schema}))
  for table,key in keys:assert not ddb.get_item(TableName=table,Key=key,ConsistentRead=True,ProjectionExpression=','.join('#k'+str(i) for i in range(len(key))),ExpressionAttributeNames={'#k'+str(i):k for i,k in enumerate(key)}).get('Item'),'UNEXPECTED_COMMITTED_ROW'
  report['independentAbsenceChecks']=len(keys);report['applicationWrites']=0
 finally:
  if created:
   lam.delete_function(FunctionName=name)
   try:lam.get_function_configuration(FunctionName=name);raise ValueError('PROBE_STILL_EXISTS')
   except lam.exceptions.ResourceNotFoundException:pass
   try:logs.delete_log_group(logGroupName='/aws/lambda/'+name)
   except logs.exceptions.ResourceNotFoundException:pass
  report['temporaryFunctionDeleted']=created;(OUT/'writer-actual-probe.json').write_text(json.dumps(report,indent=2))
 print(json.dumps({'writerActualRoleVerified':True,'committedRows':0,'temporaryFunctionDeleted':created}))
if __name__=='__main__':main()
