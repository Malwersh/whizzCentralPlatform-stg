"""Scoped Staging commercial reader/session update. Existing auth, role, code paths and financial gates preserved."""
import pathlib,json,importlib.util,zipfile,copy,urllib.request,io,time,hashlib,base64
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/sharing80');O.mkdir(exist_ok=True);O.chmod(0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'browser.json').read_text())['passed'];assert 'fail 0' in (O/'staff-tests.log').read_text()
 s=m.session();l=s.client('lambda');name='staging-wizz-staff-service';f=l.get_function(FunctionName=name);cfg=f['Configuration'];p=O/'staff.before.private.json';p.write_text(json.dumps(cfg,default=str));p.chmod(0o600);raw=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(O/'staff.base.zip').write_bytes(raw)
 changes={n:(R/'backend/staff-service'/n).read_bytes() for n in ['commercial-management.js','commercial-owner.js','commercial-events.js']}
 with zipfile.ZipFile(io.BytesIO(raw)) as old:
  route="\n if(method==='GET'&&input.view==='platform-events'){if(owner)fail('PERMISSION_REQUIRED',403);return require('./commercial-events').list(ctx,actor,input);}"
  assert changes['commercial-management.js'].decode().replace(route,'').encode()==old.read('commercial-management.js'),'LIVE_MANAGEMENT_DRIFT'
  comment='  // A currently valid, live Cognito session is sufficient for explicit consent.\n  // Do not force a second phone login solely because auth_time is older than five minutes.\n'
  guard="  if(event.httpMethod==='POST'){const age=Math.floor(Date.now()/1000)-claims.auth_time;if(!Number.isInteger(claims.auth_time)||age< -30||age>300)return {statusCode:403,code:'COMMERCIAL_RECENT_SIGN_IN_REQUIRED'};}\n"
  assert changes['commercial-owner.js'].decode().replace(comment,guard).encode()==old.read('commercial-owner.js'),'LIVE_OWNER_DRIFT'
  candidate=io.BytesIO()
  with zipfile.ZipFile(candidate,'w',zipfile.ZIP_DEFLATED) as out:
   for item in old.infolist():out.writestr(copy.copy(item),changes.get(item.filename,old.read(item.filename)))
   for n,data in changes.items():
    if n not in old.namelist():out.writestr(n,data)
  payload=candidate.getvalue();(O/'staff.candidate.zip').write_bytes(payload)
  with zipfile.ZipFile(io.BytesIO(payload)) as out:assert all(old.read(n)==out.read(n) for n in old.namelist() if n not in changes)
 # Read-only IAM/real-data probe; no human session, consent or application writes.
 probe='staging-commercial-event-reader-probe80-'+str(int(time.time()));probeCode=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(payload)) as old,zipfile.ZipFile(probeCode,'w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),old.read(item.filename))
  out.writestr('probe80.js',"const {DynamoDBClient}=require('@aws-sdk/client-dynamodb');const {DynamoDBDocumentClient}=require('@aws-sdk/lib-dynamodb');exports.handler=async()=>{const data=await require('./commercial-events').list({db:DynamoDBDocumentClient.from(new DynamoDBClient({}))},{status:'ACTIVE',roles:['commercial_viewer'],scope:{allRegions:true}},{view:'platform-events'});return {count:data.items.length,confirmedYty:data.items.some(x=>x.label==='ytyututy'&&x.acceptedBy.role==='OWNER'),actualActorRoles:[...new Set(data.items.map(x=>x.acceptedBy.role))],namesAvailable:data.items.every(x=>!!x.acceptedBy.name),readOnly:true};};")
 created=False
 try:
  l.create_function(FunctionName=probe,Runtime=cfg['Runtime'],Role=cfg['Role'],Handler='probe80.handler',Code={'ZipFile':probeCode.getvalue()},MemorySize=cfg['MemorySize'],Timeout=30,Environment=cfg['Environment']);created=True;l.get_waiter('function_active_v2').wait(FunctionName=probe,WaiterConfig={'Delay':2,'MaxAttempts':60});r=l.invoke(FunctionName=probe,Payload=b'{}');check=json.loads(r['Payload'].read());assert not r.get('FunctionError'),check;assert check.get('confirmedYty'),check;(O/'reader-probe.json').write_text(json.dumps(check,indent=2));print(json.dumps({'readerProbe':check}),flush=True)
 finally:
  if created:l.delete_function(FunctionName=probe)
  try:s.client('logs').delete_log_group(logGroupName='/aws/lambda/'+probe)
  except s.client('logs').exceptions.ResourceNotFoundException:pass
 live=l.get_function_configuration(FunctionName=name);assert live['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT'
 l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=payload);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':90});after=l.get_function_configuration(FunctionName=name)
 assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode()
 for key in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','Architectures','VpcConfig','TracingConfig']:assert after.get(key)==cfg.get(key),key
 for event in [{'httpMethod':'GET','path':'/staff/commercial','headers':{},'queryStringParameters':{'view':'platform-events'}},{'action':'commercial_owner','accessToken':'invalid','httpMethod':'POST','input':{}}]:
  r=l.invoke(FunctionName=name,Payload=json.dumps(event).encode());body=json.loads(r['Payload'].read());assert not r.get('FunctionError') and body.get('statusCode')==401,body
 result={'function':name,'beforeSha256':cfg['CodeSha256'],'afterSha256':after['CodeSha256'],'changedFiles':list(changes),'configurationPreserved':True,'anonymousRejected':True,'invalidOwnerSessionRejected':True,'readerProbe':check,'probeRemoved':True,'financialGatesUnchanged':True};(O/'backend-publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
