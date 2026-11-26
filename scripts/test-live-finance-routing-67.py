"""Temporary fixed-geometry provider probes with existing service roles; no application writes or token output."""
import pathlib,json,importlib.util,zipfile,io,uuid,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance67');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();lam=s.client('lambda');logs=s.client('logs');data=io.BytesIO()
 with zipfile.ZipFile(data,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('index.js',(O/'routing-probe.js').read_bytes())
 branch=json.loads((O/'sample-readiness.private.json').read_text())['branch'];a=branch.get('address',{});point={'latitude':branch.get('latitude',a.get('latitude')),'longitude':branch.get('longitude',a.get('longitude'))};assert all(isinstance(v,(float,int)) for v in point.values());origin={'latitude':31.913292,'longitude':44.476014}
 report={'part':67,'atUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'applicationWrites':0,'financialWrites':0,'driverLocationChanged':False,'providerCalls':0,'probes':[]}
 for key,function,secretKey in [('quote','WizzUser-DeliveryQuotes-staging','MAPBOX_SECRET_ARN'),('wave','WaveSystem_StartWave','FINANCIAL_ROUTING_SECRET_ARN')]:
  cfg=lam.get_function_configuration(FunctionName=function);env=cfg['Environment']['Variables'];assert env.get('DELIVERY_QUOTES_ENABLED','false')=='false' and env.get('FINANCIAL_DISPATCH_MODE','OFF')=='OFF';arn=env[secretKey];assert arn.startswith('arn:aws:secretsmanager:us-east-1:699561669180:secret:');name='staging-finance67-route-'+key+'-'+uuid.uuid4().hex[:8];created=False;row={'host':function,'usesExistingRole':True,'temporaryFunctionDeleted':False};report['probes'].append(row)
  try:
   lam.create_function(FunctionName=name,Runtime='nodejs22.x',Role=cfg['Role'],Handler='index.handler',Code={'ZipFile':data.getvalue()},Timeout=25,MemorySize=256,Environment={'Variables':{'ROUTING_PROBE_SECRET_ARN':arn,'ROUTING_PROBE_GEOMETRY':json.dumps({'origin':origin,'destination':point}),'ROUTING_PROBE_COVERAGE':'true' if key=='quote' else 'false'}});created=True;lam.get_waiter('function_active_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60});response=lam.invoke(FunctionName=name,Payload=b'{}');assert not response.get('FunctionError'),'PROBE_RUNTIME_FAILED';row['result']=json.loads(response['Payload'].read());report['providerCalls']+=1
  finally:
   if created:
    lam.delete_function(FunctionName=name);row['temporaryFunctionDeleted']=True
    try:logs.delete_log_group(logGroupName='/aws/lambda/'+name)
    except logs.exceptions.ResourceNotFoundException:pass
   (O/'routing-probe-result.json').write_text(json.dumps(report,indent=2))
  print(json.dumps({'host':key,'result':row.get('result'),'temporaryFunctionDeleted':row['temporaryFunctionDeleted']}),flush=True)
 assert all(x['result']['routingReady'] and x['temporaryFunctionDeleted'] for x in report['probes']),'ROUTING_NOT_READY'
if __name__=='__main__':main()
