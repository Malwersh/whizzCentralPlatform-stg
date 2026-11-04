"""Publish final provider outcome handling, backfill notification intents, verify real role, enable schedule."""
import pathlib,json,importlib.util,zipfile,copy,hashlib,base64,urllib.request,subprocess,time,io
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing78');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 state=json.loads((O/'publication.json').read_text());assert len(state['functions'])==4 and not state['deliveryEnabled'];s=m.session();l=s.client('lambda');cf=s.client('cloudformation');inv=json.loads((O/'inventory.json').read_text());name=inv['push']['name'];f=l.get_function(FunctionName=name);cfg=f['Configuration'];expected=next(x['afterSha256'] for x in state['functions'] if x['name']==name);assert cfg['CodeSha256']==expected
 (O/'push.first-release.zip').write_bytes(urllib.request.urlopen(f['Code']['Location'],timeout=90).read());replacement=(O/'commercial-sharing-push.final.js').read_bytes()
 with zipfile.ZipFile(O/'push.first-release.zip') as old:
  with zipfile.ZipFile(O/'push.final.zip','w',zipfile.ZIP_DEFLATED) as out:
   for i in old.infolist():out.writestr(copy.copy(i),replacement if i.filename=='src/utils/commercial-sharing-push.js' else old.read(i.filename))
  with zipfile.ZipFile(O/'push.final.zip') as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n!='src/utils/commercial-sharing-push.js')
 payload=(O/'push.final.zip').read_bytes();l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name);assert after['Environment']==cfg['Environment'] and after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode();state['finalPushSha256']=after['CodeSha256'];save=lambda:(O/'publication.json').write_text(json.dumps(state,indent=2));save()
 subprocess.run(['python3','scripts/backfill-commercial-notices-78.py'],cwd=R,check=True);backfill=json.loads((O/'backfill.json').read_text());state['backfilledNoticeCount']=backfill['queuedCount']
 # Read-only verification on the exact live push role and runtime. No Firebase call or fabricated human session.
 probe='wizzcentral-notifications-staging-sharing-probe78-'+str(int(time.time()));z=io.BytesIO();code="const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');exports.handler=async event=>require('./commercial-sharing-push').send(event,{db:DynamoDBDocumentClient.from(new DynamoDBClient({})),tokensTable:process.env.PUSH_TOKENS_TABLE,dryRun:true,getMessaging:async()=>{throw Error('DRY_RUN_MUST_NOT_SEND');}});"
 with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as archive:archive.writestr('index.js',code);archive.writestr('commercial-sharing-push.js',replacement)
 created=False;checks=[]
 try:
  l.create_function(FunctionName=probe,Runtime=cfg['Runtime'],Role=cfg['Role'],Handler='index.handler',Code={'ZipFile':z.getvalue()},MemorySize=256,Timeout=30,Environment={'Variables':{'PUSH_TOKENS_TABLE':cfg['Environment']['Variables']['PUSH_TOKENS_TABLE']}});created=True;l.get_waiter('function_active_v2').wait(FunctionName=probe,WaiterConfig={'Delay':2,'MaxAttempts':90})
  for key in backfill['noticeKeys']:
   response=l.invoke(FunctionName=probe,Payload=json.dumps({'action':'commercial_notice',**key}).encode());body=json.loads(response['Payload'].read());assert not response.get('FunctionError'),body;assert body.get('verified') is True or body.get('cancelled') is True;checks.append(body)
 finally:
  if created:l.delete_function(FunctionName=probe)
  try:s.client('logs').delete_log_group(logGroupName='/aws/lambda/'+probe)
  except s.client('logs').exceptions.ResourceNotFoundException:pass
 state['targetingDryRunChecks']=checks;state['probeDeleted']=True;save();print(json.dumps({'noticeCount':len(checks),'targetingChecks':checks}),flush=True)
 cf.update_stack(StackName=state['stackName'],UsePreviousTemplate=True,Parameters=[{'ParameterKey':'StaffRoleName','UsePreviousValue':True},{'ParameterKey':'PushRoleName','UsePreviousValue':True},{'ParameterKey':'DeliveryEnabled','ParameterValue':'true'}],Capabilities=['CAPABILITY_NAMED_IAM']);cf.get_waiter('stack_update_complete').wait(StackName=state['stackName'],WaiterConfig={'Delay':2,'MaxAttempts':120});state['deliveryEnabled']=True;save()
 # User explicitly requested notifications. Process the verified pending requests through the deployed worker.
 response=l.invoke(FunctionName=inv['staff']['name'],Payload=b'{"action":"commercial_notice_tick"}');body=json.loads(response['Payload'].read());assert not response.get('FunctionError'),body;state['liveWorkerResult']=body;save();print(json.dumps({'deliveryEnabled':True,'liveWorkerResult':body,'financialActivation':False}))
if __name__=='__main__':main()
