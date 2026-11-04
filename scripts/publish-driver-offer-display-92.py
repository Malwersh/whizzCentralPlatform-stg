"""Publish only the reviewed driver display overlay; preserve code outside one runtime and all config."""
import pathlib,json,importlib.util,zipfile,copy,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance92')
sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert 'All tests passed!' in (O/'flutter-tests.log').read_text()
 assert 'error •' not in pathlib.Path('/private/tmp/finance91/driver-analyze92-final.log').read_text()
 assert 'fail 0' in pathlib.Path('/private/tmp/finance91/backend-tests92.log').read_text()
 cfg=json.loads((O/'config.private.json').read_text());l=m.session().client('lambda');live=l.get_function_configuration(FunctionName=cfg['FunctionName']);assert live['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT'
 with zipfile.ZipFile(O/'base.zip') as old,zipfile.ZipFile(O/'candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),(O/'financial-runtime.js').read_bytes() if item.filename=='financial-runtime.js' else old.read(item.filename))
 with zipfile.ZipFile(O/'base.zip') as old,zipfile.ZipFile(O/'candidate.zip') as out:
  assert old.namelist()==out.namelist()
  assert all(old.read(n)==out.read(n) for n in old.namelist() if n!='financial-runtime.js')
 payload=(O/'candidate.zip').read_bytes();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=payload)
 l.get_waiter('function_updated_v2').wait(FunctionName=cfg['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90})
 after=l.get_function_configuration(FunctionName=cfg['FunctionName']);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
 for f in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert after.get(f)==cfg.get(f),f
 result={'published':True,'function':cfg['FunctionName'],'changedFiles':['financial-runtime.js'],'configurationPreserved':True,'financialTermsChanged':False,'orderOrWalletWrites':False}
 (O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
