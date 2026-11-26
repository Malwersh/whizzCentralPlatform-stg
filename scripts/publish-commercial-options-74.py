"""Move option reads behind live staff authorization with attribute-limited Lambda IAM."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,base64,time,io
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/options74');O.mkdir(exist_ok=True);sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();l=s.client('lambda');iam=s.client('iam');cf=s.client('cloudformation');name='staging-wizz-staff-service';f=l.get_function(FunctionName=name);cfg=f['Configuration'];blob=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(O/'staff.base.zip').write_bytes(blob);(O/'staff.config.private.json').write_text(json.dumps(cfg));changes={n:(R/'backend/staff-service'/n).read_bytes() for n in ['commercial-management.js','commercial-options.js']}
 with zipfile.ZipFile(O/'staff.base.zip') as old:
  with zipfile.ZipFile('/private/tmp/reference72/staff.candidate.zip') as previous:assert old.read('commercial-management.js')==previous.read('commercial-management.js'),'LIVE_COMMERCIAL_DRIFT'
  assert 'commercial-options.js' not in old.namelist()
  with zipfile.ZipFile(O/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   out.writestr('commercial-options.js',changes['commercial-options.js'])
  with zipfile.ZipFile(O/'staff.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 template=json.loads((R/'backend/commercial-options-read.staging.json').read_text());policy=template['Resources']['CommercialOptionsReadPolicy']['Properties']['PolicyDocument'];fields=policy['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes'];resources=policy['Statement'][0]['Resource'];context=[{'ContextKeyName':'dynamodb:Select','ContextKeyType':'string','ContextKeyValues':['SPECIFIC_ATTRIBUTES']},{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':fields}];checks=[]
 for table in resources:
  res=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=['dynamodb:Scan'],ResourceArns=[table],ContextEntries=context);assert res['EvaluationResults'][0]['EvalDecision']=='allowed';checks.append('projected_read_allowed')
 for mode in ['all_fields','foreign_attribute','write','ledger']:
  ctx=json.loads(json.dumps(context));action='dynamodb:Scan';resource=resources[0]
  if mode=='all_fields':ctx[0]['ContextKeyValues']=['ALL_ATTRIBUTES']
  if mode=='foreign_attribute':ctx[1]['ContextKeyValues']=fields+['phoneNumber']
  if mode=='write':action='dynamodb:PutItem'
  if mode=='ledger':resource='arn:aws:dynamodb:us-east-1:699561669180:table/staging-Ledger'
  res=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=[action],ResourceArns=[resource],ContextEntries=ctx);assert res['EvaluationResults'][0]['EvalDecision']!='allowed';checks.append(mode+'_not_granted')
 stack='staging-commercial-options-read-74';cf.create_stack(StackName=stack,TemplateBody=json.dumps(template),Parameters=[{'ParameterKey':'StaffRoleName','ParameterValue':cfg['Role'].split('/')[-1]}],Capabilities=['CAPABILITY_NAMED_IAM'])
 for _ in range(100):
  status=cf.describe_stacks(StackName=stack)['Stacks'][0]['StackStatus'];assert status not in ['CREATE_FAILED','ROLLBACK_COMPLETE','ROLLBACK_FAILED']
  if status=='CREATE_COMPLETE':break
  time.sleep(3)
 assert status=='CREATE_COMPLETE'
 for resource in resources:
  result=iam.simulate_principal_policy(PolicySourceArn=cfg['Role'],ActionNames=['dynamodb:Scan'],ResourceArns=[resource],ContextEntries=context);assert result['EvaluationResults'][0]['EvalDecision']=='allowed'
 live=l.get_function_configuration(FunctionName=name);assert live['RevisionId']==cfg['RevisionId'];payload=(O/'staff.candidate.zip').read_bytes();l.update_function_code(FunctionName=name,ZipFile=payload,RevisionId=cfg['RevisionId']);l.get_waiter('function_updated_v2').wait(FunctionName=name);after=l.get_function_configuration(FunctionName=name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode();assert after['Environment']==cfg['Environment']
 result={'name':name,'beforeSha256':cfg['CodeSha256'],'afterSha256':after['CodeSha256'],'changedFiles':list(changes),'accessStack':stack,'policyChecks':checks,'browserRoleChanged':False,'configurationPreserved':True,'applicationDataWrites':False};(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
 # Probe only the metadata reader with the real service role, not a fabricated employee session.
 probe='staging-commercial-options-probe-74-'+str(int(time.time()));stream=io.BytesIO()
 handler="const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');exports.handler=async()=>{const db=DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1'}));const options=await require('./commercial-options').load(db,'business_95ac73c9-feda-4207-9285-550aec61b94c');return {count:options.length,merchant:options.filter(o=>o.source==='MERCHANT').length,platform:options.filter(o=>o.source==='PLATFORM').length};};"
 with zipfile.ZipFile(stream,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.js',handler);z.writestr('commercial-options.js',changes['commercial-options.js'])
 created=False
 try:
  l.create_function(FunctionName=probe,Runtime='nodejs20.x',Role=cfg['Role'],Handler='index.handler',Code={'ZipFile':stream.getvalue()},Timeout=60,MemorySize=256);created=True;l.get_waiter('function_active_v2').wait(FunctionName=probe);response=l.invoke(FunctionName=probe,Payload=b'{}');body=json.loads(response['Payload'].read());assert 'FunctionError' not in response,body;result['realRoleReadProbe']=body
 finally:
  if created:l.delete_function(FunctionName=probe)
  try:s.client('logs').delete_log_group(logGroupName='/aws/lambda/'+probe)
  except s.client('logs').exceptions.ResourceNotFoundException:pass
 result['probeDeleted']=True;(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps({'realRoleReadProbe':result['realRoleReadProbe'],'probeDeleted':True}))
if __name__=='__main__':main()
