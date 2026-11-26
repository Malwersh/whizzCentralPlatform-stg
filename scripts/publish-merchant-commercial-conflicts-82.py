"""Patch only merchant commercial proxy error translation; never consent or rebase terms."""
import pathlib,json,importlib.util,zipfile,copy,urllib.request,io,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];M=R.parent/'whizzMerchants-stg';O=pathlib.Path('/private/tmp/sharing82');O.mkdir(exist_ok=True);O.chmod(0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();l=s.client('lambda');name='order-receiver-regional-staging-unified-auth-v4-sam';f=l.get_function(FunctionName=name);cfg=f['Configuration'];p=O/'auth.before.private.json';p.write_text(json.dumps(cfg,default=str));p.chmod(0o600);raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(O/'auth.base.zip').write_bytes(raw)
 data=(M/'backend/functions/auth/commercial_agreements.js').read_bytes()
 addition=" // Existing phone clients already translate this safe conflict into a clear\n // request to review renewed sharing terms. Never disguise it as a provider outage.\n if(data.statusCode===409&&['CAMPAIGN_VERSION_REQUIRED','CAMPAIGN_PERIOD_CHANGED'].includes(data.code))fail('FUNDING_TERMS_CHANGED',409);\n"
 with zipfile.ZipFile(io.BytesIO(raw)) as old:
  paths=[n for n in old.namelist() if pathlib.PurePosixPath(n).name=='commercial_agreements.js'];assert len(paths)==1,paths;target=paths[0];live=old.read(target)
  if data.decode().replace(addition,'').encode()!=live:
   # The live proxy is an esbuild bundle. Preserve every dependency byte and
   # insert the equivalent guard only at its unique business-code error branch.
   marker=b'  if (data.statusCode !== 200) {\n';assert live.count(marker)==1,'LIVE_PROXY_SHAPE_CHANGED';assert b'async function route(event, input,' in live and b'staging-wizz-staff-service' in live
   guard=b'  if (data.statusCode === 409 && ["CAMPAIGN_VERSION_REQUIRED", "CAMPAIGN_PERIOD_CHANGED"].includes(data.code)) fail("FUNDING_TERMS_CHANGED", 409);\n'
   data=live.replace(marker,guard+marker,1);assert data.replace(guard,b'',1)==live
   (O/'commercial-proxy.candidate.cjs').write_bytes(data)
   import subprocess
   subprocess.run(['node','-e',"const assert=require('node:assert/strict');process.env.COMMERCIAL_ADMIN_ENABLED='true';const {route}=require(process.argv[1]);(async()=>{for(const code of ['CAMPAIGN_VERSION_REQUIRED','CAMPAIGN_PERIOD_CHANGED','internal-db-secret'])await assert.rejects(route({httpMethod:'POST',headers:{Authorization:'Bearer test-fixture'}},{},{send:async()=>({Payload:Buffer.from(JSON.stringify({statusCode:409,code}))})}),e=>e.message===(code==='internal-db-secret'?'COMMERCIAL_UNAVAILABLE':'FUNDING_TERMS_CHANGED'));console.log('Bundled proxy conflict mapping passed');})().catch(e=>{console.error(e);process.exitCode=1;});",str(O/'commercial-proxy.candidate.cjs')],check=True)

  z=io.BytesIO()
  with zipfile.ZipFile(z,'w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),data if item.filename==target else old.read(item.filename))
  payload=z.getvalue();(O/'auth.candidate.zip').write_bytes(payload)
  with zipfile.ZipFile(io.BytesIO(payload)) as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n!=target)
 l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name)
 assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
 for key in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert cfg.get(key)==after.get(key),key
 response=l.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'GET','path':'/auth/commercial-agreements','headers':{},'queryStringParameters':{'businessId':'unauthenticated-test'}}).encode());body=json.loads(response['Payload'].read());assert not response.get('FunctionError') and body.get('statusCode')==401,body
 result={'function':name,'changedFile':target,'beforeSha256':cfg['CodeSha256'],'afterSha256':after['CodeSha256'],'otherFilesPreserved':True,'configurationPreserved':True,'anonymousRejected':True,'campaignsOrDraftsChanged':False,'ownerConsentSubmitted':False,'phoneBuildChanged':False};(O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
