"""Temporary, one-order, impossible-to-commit service-role diagnostic; restore original code in finally."""
import boto3,pathlib,json,zipfile,io,copy,urllib.request,hashlib,base64,time
from botocore.config import Config
p=pathlib.Path('/private/tmp/dispatch-test-162');l=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1').client('lambda',config=Config(connect_timeout=60,read_timeout=90,retries={'max_attempts':2}));name='WaveSystem_StartWave';r=l.get_function(FunctionName=name);cfg=r['Configuration'];old=urllib.request.urlopen(r['Code']['Location']).read();assert base64.b64encode(hashlib.sha256(old).digest()).decode()==cfg['CodeSha256'];(p/'diagnostic-service-original.zip').write_bytes(old)
tx=json.loads((p/'diagnostic-transaction.private.json').read_text());tx['TransactItems'][-1]['ConditionCheck']['ConditionExpression']='attribute_exists(pk) AND attribute_not_exists(pk)';assert tx['TransactItems'][-1]['ConditionCheck']['TableName']=='staging-PlatformStaff'
oid=json.load(open('/private/tmp/financial-device-test-161/selector.private.json'))['orderId'];z=zipfile.ZipFile(io.BytesIO(old));source=z.read('index.js').decode();source+='\nconst realHandler162=exports.handler;exports.handler=async(event,context)=>{if(event?.internalDiagnostic162!=="'+oid+'")return realHandler162(event,context);const tx=require("./diagnostic-transaction-162.json");const last=tx.TransactItems[tx.TransactItems.length-1].ConditionCheck;if(last.ConditionExpression!=="attribute_exists(pk) AND attribute_not_exists(pk)")throw Error("DIAGNOSTIC_BLOCKER_REQUIRED");try{await new (require("aws-sdk").DynamoDB.DocumentClient)().transactWrite(tx).promise();throw Error("IMPOSSIBLE_COMMIT");}catch(e){return {name:e.name,message:e.message,reasons:(e.CancellationReasons||[]).map(r=>r.Code),forcedFailure:true};}};\n'
out=io.BytesIO()
with zipfile.ZipFile(out,'w') as dest:
 for item in z.infolist():dest.writestr(copy.copy(item),source.encode() if item.filename=='index.js' else z.read(item.filename))
 dest.writestr('diagnostic-transaction-162.json',json.dumps(tx))
def wait():
 for _ in range(60):
  c=l.get_function_configuration(FunctionName=name)
  if c['LastUpdateStatus']!='InProgress':assert c['LastUpdateStatus']=='Successful';return c
  time.sleep(2)
 raise RuntimeError('UPDATE_TIMEOUT')
candidate=out.getvalue();proof={'originalCodeSha256':cfg['CodeSha256'],'restored':False};(p/'service-diagnostic-receipt.private.json').write_text(json.dumps(proof))
try:
 l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=candidate);c=wait();assert c['CodeSha256']==base64.b64encode(hashlib.sha256(candidate).digest()).decode()
 r=l.invoke(FunctionName=name,InvocationType='RequestResponse',Payload=json.dumps({'internalDiagnostic162':oid}).encode());result=json.loads(r['Payload'].read());(p/'service-diagnostic-result.private.json').write_text(json.dumps(result));print(json.dumps(result),flush=True)
finally:
 current=l.get_function_configuration(FunctionName=name);assert current['Environment']==cfg['Environment'];assert current['CodeSha256'] in [cfg['CodeSha256'],base64.b64encode(hashlib.sha256(candidate).digest()).decode()]
 if current['CodeSha256']!=cfg['CodeSha256']:l.update_function_code(FunctionName=name,RevisionId=current['RevisionId'],ZipFile=old);current=wait()
 assert current['CodeSha256']==cfg['CodeSha256'];proof['restored']=True;(p/'service-diagnostic-receipt.private.json').write_text(json.dumps(proof));print('ORIGINAL_SERVICE_CODE_RESTORED',flush=True)
