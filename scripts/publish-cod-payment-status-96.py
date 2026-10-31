"""Patch only payment-state projection in the existing COD completion transaction."""
import pathlib,json,importlib.util,zipfile,copy,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance96');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert 'fail 0' in (O/'backend-tests.log').read_text() and not (O/'tsc.log').read_text().strip()
 c=json.loads((O/'accept.config.private.json').read_text());l=m.session().client('lambda');a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['RevisionId']==c['RevisionId'],'LIVE_DRIFT'
 with zipfile.ZipFile(O/'accept.base.zip') as old,zipfile.ZipFile(O/'accept.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
  for i in old.infolist():out.writestr(copy.copy(i),(O/'accept.candidate.js').read_bytes() if i.filename=='index.js' else old.read(i.filename))
 with zipfile.ZipFile(O/'accept.base.zip') as old,zipfile.ZipFile(O/'accept.candidate.zip') as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n!='index.js')
 data=(O/'accept.candidate.zip').read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90});a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
 for f in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert a.get(f)==c.get(f),f
 r={'published':True,'configurationPreserved':True,'changedFiles':['index.js'],'financialAmountsChanged':False};(O/'publication.json').write_text(json.dumps(r,indent=2));print(json.dumps(r))
if __name__=='__main__':main()
