"""Exercise the captured published factories under their live roles in disposable Lambdas."""
import hashlib, io, json, pathlib, time, uuid, zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1];OUT=pathlib.Path('/private/tmp/finance57')
def main():
 import boto3
 from botocore.config import Config
 s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180'
 lam=s.client('lambda',config=Config(read_timeout=65,retries={'total_max_attempts':1}));logs=s.client('logs');iam=s.client('iam');state=json.loads((OUT/'routing-bindings-verification.json').read_text());nonce=uuid.uuid4().hex;created=[];report={'part':57,'environment':'Staging','applicationGatesChanged':False,'checks':[],'financialWrites':0,'humanRowsRead':False}
 def save():(OUT/'routing-actual-probes.json').write_text(json.dumps(report,indent=2)+'\n')
 try:
  for kind,target in [('quote','WizzUser-DeliveryQuotes-staging'),('wave','WaveSystem_StartWave')]:
   cfg=lam.get_function_configuration(FunctionName=target);record=next(x for x in state['functions'] if x['name']==target);assert cfg['RevisionId']==record['revisionId'] and cfg['CodeSha256']==record['codeSha256']
   # Use only the published runtime and its original external modules, unchanged.
   data=io.BytesIO()
   with zipfile.ZipFile(OUT/(target+'.zip')) as old,zipfile.ZipFile(data,'w',zipfile.ZIP_DEFLATED) as new:
    runtime='index.js' if kind=='quote' else 'financial-runtime.js';body=old.read(runtime);new.writestr('index.js',body+b'\n'+(ROOT/'scripts/finance-routing-probe-57.cjs').read_bytes())
    if kind=='wave':
     for name in ['finance-rollout.js','dispatch-settings-contract.js']:new.writestr(name,old.read(name))
   name='finance57-routing-probe-'+kind+'-'+nonce[:12];env={'STAGE':'staging','PROBE_ID':nonce,'PROBE_KIND':kind,'PROBE_SECRET_ARN':state['secretArn']}
   lam.create_function(FunctionName=name,Runtime=cfg['Runtime'],Role=cfg['Role'],Handler='index.routingProbe',Timeout=50,MemorySize=256,Code={'ZipFile':data.getvalue()},Environment={'Variables':env},Description='Disposable published routing factory/IAM check; no public trigger or finance writes');created.append(name);save()
   lam.get_waiter('function_active_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60})
   response=lam.invoke(FunctionName=name,Payload=json.dumps({'probeId':nonce}).encode(),InvocationType='RequestResponse');result=json.load(response['Payload']);assert not response.get('FunctionError'), 'PROBE_RUNTIME_ERROR'
   report['checks'].append({'function':target,'role':cfg['Role'],'runtimeSha256':hashlib.sha256(body).hexdigest(),**result});save();assert result.get('ok') is True,result.get('code','PROBE_FAILED')
   print(json.dumps({'publishedRuntime':target,'actualRoleRoutingPassed':True,'providerRequests':result['providerRequests'],'coverageChecked':kind=='quote'}),flush=True)
  simulations=[]
  for f in state['functions']:
   for action,resource,expected in [('secretsmanager:GetSecretValue',state['secretArn'],'allowed' if f['secretBindingChanged'] else 'implicitDeny'),('secretsmanager:PutSecretValue',state['secretArn'],'implicitDeny'),('secretsmanager:GetSecretValue',state['secretArn']+'-foreign','implicitDeny')]:
    value=iam.simulate_principal_policy(PolicySourceArn=f['role'],ActionNames=[action],ResourceArns=[resource])['EvaluationResults'][0]['EvalDecision'];simulations.append({'function':f['name'],'action':action,'resourceKind':'routing' if resource==state['secretArn'] else 'foreign','decision':value});assert value==expected,'UNEXPECTED_EFFECTIVE_ACCESS'
  report['effectiveIamSimulation']=simulations
 finally:
  errors=[]
  for name in created:
   try:
    lam.delete_function(FunctionName=name)
    try:lam.get_function_configuration(FunctionName=name);raise ValueError('PROBE_STILL_EXISTS')
    except lam.exceptions.ResourceNotFoundException:pass
   except Exception as e:errors.append({'function':name,'error':type(e).__name__})
   try:logs.delete_log_group(logGroupName='/aws/lambda/'+name)
   except logs.exceptions.ResourceNotFoundException:pass
   except Exception as e:errors.append({'logGroup':name,'error':type(e).__name__})
  report['cleanup']={'temporaryFunctionsDeleted':len(created),'errors':errors};save()
  assert not errors,'CLEANUP_INCOMPLETE'
 print(json.dumps({'actualRolesVerified':len(report['checks']),'temporaryFunctionsDeleted':len(created),'activation':False}))
if __name__=='__main__':main()
