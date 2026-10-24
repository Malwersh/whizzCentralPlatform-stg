"""Preserve live bundle/config; add only sanitized failure codes to COD integration catch."""
import pathlib,json,importlib.util,zipfile,io,urllib.request,copy,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance97');O.mkdir(exist_ok=True)
s=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
l=m.session().client('lambda');f=l.get_function(FunctionName='staging-cod-integration');c=f['Configuration'];data=urllib.request.urlopen(f['Code']['Location']).read();(O/'base.zip').write_bytes(data);(O/'config.private.json').write_text(json.dumps(c,default=str));(O/'config.private.json').chmod(0o600)
with zipfile.ZipFile(io.BytesIO(data)) as old:
 source=old.read('index.js').decode();needle='    } catch (error2) {\n      const fresh = await strongGet(db, T.events, { operationId });';assert source.count(needle)==1
 log="    } catch (error2) {\n      console.error('COD_INTEGRATION_FAILURE', JSON.stringify({name:String(error2?.name??'Unknown').replace(/[^A-Za-z0-9_]/g,'').slice(0,80),code:String(error2?.code??'').replace(/[^A-Za-z0-9_]/g,'').slice(0,80),reasons:Array.isArray(error2?.CancellationReasons)?error2.CancellationReasons.map(r=>String(r?.Code??'None').replace(/[^A-Za-z0-9_]/g,'').slice(0,80)):[]}));\n      const fresh = await strongGet(db, T.events, { operationId });"
 patched=source.replace(needle,log)
 with zipfile.ZipFile(O/'candidate.zip','w',zipfile.ZIP_DEFLATED) as z:
  for i in old.infolist():z.writestr(copy.copy(i),patched.encode() if i.filename=='index.js' else old.read(i.filename))
assert not (pathlib.Path('/private/tmp/finance96/diagnostic-tsc.log').read_text().strip())
assert 'fail 0' in pathlib.Path('/private/tmp/finance96/diagnostic-tests.log').read_text()
a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['RevisionId']==c['RevisionId'],'LIVE_DRIFT'
data=(O/'candidate.zip').read_bytes();l.update_function_code(FunctionName=c['FunctionName'],RevisionId=c['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'],WaiterConfig={'Delay':1,'MaxAttempts':90});a=l.get_function_configuration(FunctionName=c['FunctionName']);assert a['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
for k in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert a.get(k)==c.get(k),k
result={'published':True,'change':'sanitized error codes only','configurationPreserved':True,'walletLedgerChanges':False};(O/'publication.json').write_text(json.dumps(result));print(json.dumps(result))
