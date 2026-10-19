"""Publish scoped wave-continuation repairs, then open only the existing financial timeout gate.
Never invokes a generic worker; observes the existing scheduler afterwards.
"""
import pathlib,json,importlib.util,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance93')
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert 'fail 0' in (O/'tests.log').read_text() and not (O/'tsc.log').read_text().strip()
 inventory=json.loads((O/'inventory.private.json').read_text());l=m.session().client('lambda');scopes=[]
 for c in inventory.values():
  a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['RevisionId']==c['RevisionId'],'LIVE_DRIFT'
  scopes.append(a['Environment']['Variables']['FINANCE_ROLLOUT_SHA256'])
 assert len(set(scopes))==1
 result={'published':[],'scheduledWorkerInvokedManually':False,'scopePreserved':True,'financialTimeoutGate':False}
 for key in ['wave','timeout']:
  c=inventory[key];payload=(O/(key+'.candidate.zip')).read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=payload)
  l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90})
  a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
  for field in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert a.get(field)==c.get(field),(key,field)
  result['published'].append(c['FunctionName']);print(json.dumps({'published':key}),flush=True)
  if key=='timeout':
   e={**a['Environment']['Variables'],'FINANCIAL_DISPATCH_MODE':'REQUIRED'}
   l.update_function_configuration(FunctionName=a['FunctionName'],RevisionId=a['RevisionId'],Environment={'Variables':e})
   l.get_waiter('function_updated_v2').wait(FunctionName=a['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90})
   after=l.get_function_configuration(FunctionName=a['FunctionName']);assert after['Environment']['Variables']==e and after['CodeSha256']==a['CodeSha256']
   result['financialTimeoutGate']=True
 (O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
