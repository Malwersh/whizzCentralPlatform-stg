"""Install a disabled schedule, publish scoped notice modules, then leave activation to verified finalization."""
import pathlib,json,importlib.util,base64,hashlib,time
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing78');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'dynamo-test.json').read_text())['isolatedTableDeleted'];assert json.loads((O/'browser.log').read_text())['passed'];s=m.session();cf=s.client('cloudformation');l=s.client('lambda');iam=s.client('iam');inv=json.loads((O/'inventory.json').read_text());prep=json.loads((O/'preparation.json').read_text());template=json.loads((R/'backend/commercial-notices.staging.json').read_text());stack='staging-commercial-sharing-notices-78';result={'part':78,'stackName':stack,'functions':[],'financialActivation':False,'deliveryEnabled':False}
 save=lambda:(O/'publication.json').write_text(json.dumps(result,indent=2))
 for k,v in inv.items():
  c=l.get_function_configuration(FunctionName=v['name']);assert c['RevisionId']==v['revisionId'] and c['CodeSha256']==v['codeSha256'],'LIVE_DRIFT '+k
 policy=template['Resources']['PushOwnerNoticeRead']['Properties']['PolicyDocument'];fields=policy['Statement'][0]['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes']
 for key,expected in [('DISCOUNT_FUNDING#synthetic','allowed'),('EMPLOYEE#synthetic','implicitDeny')]:
  r=iam.simulate_custom_policy(PolicyInputList=[json.dumps(policy)],ActionNames=['dynamodb:GetItem'],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff'],ContextEntries=[{'ContextKeyName':'dynamodb:Attributes','ContextKeyType':'stringList','ContextKeyValues':fields},{'ContextKeyName':'dynamodb:LeadingKeys','ContextKeyType':'stringList','ContextKeyValues':[key]}]);assert r['EvaluationResults'][0]['EvalDecision']==expected
 cf.create_stack(StackName=stack,TemplateBody=json.dumps(template),Parameters=[{'ParameterKey':'StaffRoleName','ParameterValue':inv['staff']['role'].split('/')[-1]},{'ParameterKey':'PushRoleName','ParameterValue':inv['push']['role'].split('/')[-1]},{'ParameterKey':'DeliveryEnabled','ParameterValue':'false'}],Capabilities=['CAPABILITY_NAMED_IAM']);cf.get_waiter('stack_create_complete').wait(StackName=stack,WaiterConfig={'Delay':2,'MaxAttempts':120});save();print(json.dumps({'stackCreated':stack,'scheduleEnabled':False}),flush=True)
 for k in ['expiry','worker','push','staff']:
  v=inv[k];c=l.get_function_configuration(FunctionName=v['name']);assert c['RevisionId']==v['revisionId'] and c['CodeSha256']==v['codeSha256'];payload=(O/(k+'.candidate.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(payload).digest()).decode()==prep[k]['codeSha256'];l.update_function_code(FunctionName=v['name'],RevisionId=c['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=v['name'],WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=v['name']);assert after['CodeSha256']==prep[k]['codeSha256'];before=json.loads((O/(k+'.config.private.json')).read_text())
  for f in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert after.get(f)==before.get(f),'CONFIG_DRIFT '+k
  result['functions'].append({'name':v['name'],'beforeSha256':v['codeSha256'],'afterSha256':after['CodeSha256'],'changedFiles':prep[k]['changedFiles'],'configurationPreserved':True});save();print(json.dumps({'published':k}),flush=True)
 # Invalid/untrusted envelopes must never initialize Firebase or send anything.
 for k,event in [('push',{'action':'commercial_notice','pk':'INVALID','sk':'NOTICE#1'}),('staff',{'httpMethod':'GET','path':'/staff/commercial','headers':{},'queryStringParameters':{'businessId':'untrusted','view':'pending-sharing'}})]:
  response=l.invoke(FunctionName=inv[k]['name'],Payload=json.dumps(event).encode());body=json.loads(response['Payload'].read());assert not response.get('FunctionError'),body
  if k=='push':assert body=={'cancelled':True}
  else:assert body['statusCode']==401
 result['invalidPushCancelled']=True;result['anonymousStaffRejected']=True;save();print(json.dumps({'publishedFunctions':4,'deliveryEnabled':False,'runtimeGuardsPassed':True}))
if __name__=='__main__':main()
