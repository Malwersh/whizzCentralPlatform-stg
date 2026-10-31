"""Publish narrow OTP routing overlays captured by prepare-otpiq-telegram-116.py."""
import pathlib,importlib.util,json,hashlib,base64,datetime
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/otpiq-telegram-116')
def main():
 sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m);lam=m.session().client('lambda');rows=json.loads((O/'preparation.json').read_text());assert len(rows)==6;assert not (O/'publication.json').exists(),'PUBLICATION_ALREADY_STARTED'
 for row in rows:
  c=lam.get_function_configuration(FunctionName=row['name']);assert c['RevisionId']==row['revisionId'] and c['CodeSha256']==row['baseCodeSha256'],'LIVE_DRIFT'
 results=[]
 for row in rows:
  name=row['name'];before=json.loads((O/(name+'.private.json')).read_text());payload=(O/(name+'.candidate.zip')).read_bytes();assert base64.b64encode(hashlib.sha256(payload).digest()).decode()==row['candidateSha256']
  lam.update_function_code(FunctionName=name,RevisionId=row['revisionId'],ZipFile=payload,Publish=False);lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':45});after=lam.get_function_configuration(FunctionName=name);assert after['CodeSha256']==row['candidateSha256'];assert after.get('Environment',{})==before.get('Environment',{})
  env=before.get('Environment',{}).get('Variables',{})
  if row['envKey']:
   env={**env,row['envKey']:'whatsapp-telegram-sms'};lam.update_function_configuration(FunctionName=name,RevisionId=after['RevisionId'],Environment={'Variables':env});lam.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':45});after=lam.get_function_configuration(FunctionName=name)
  assert after.get('Environment',{}).get('Variables',{})==env
  assert all(after.get(k)==before.get(k) for k in ['Role','Runtime','Handler','MemorySize','Timeout','Layers','VpcConfig','Architectures','TracingConfig'])
  results.append({'name':name,'codeSha256':after['CodeSha256'],'revisionId':after['RevisionId'],'changedEntry':row['entry'],'provider':'whatsapp-telegram-sms','otherConfigurationPreserved':True})
  result={'part':116,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':results,'messagesSentByMaintenance':0,'iamChanged':False,'applicationDataChanged':False,'actualDeliveryTested':False};(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps({'published':name}),flush=True)
 (R/'docs/otp-telegram-fallback-staging-116.json').write_text(json.dumps(result,indent=2)+'\n')
if __name__=='__main__':main()
