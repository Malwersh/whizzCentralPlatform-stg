"""Publish bounded Staging code overlays only; never invoke a business action."""
import boto3,json,pathlib,zipfile,copy,hashlib,base64,time
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/order-management-247';s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');inv=json.loads((P/'inventory.private.json').read_text());report={}
changes={'financial':{'index.js':P/'financial-candidate.js','staff-order-management-runtime.js':P/'staff-order-management-runtime.js'},'staff':{'_discount_review/central-staff/index.js':P/'staff-candidate.js','order-management.js':R/'backend/staff-service/order-management.js'}}
for k,entries in changes.items():
 cfg=inv[k];assert l.get_function_configuration(FunctionName=cfg['FunctionName'])['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT'
 with zipfile.ZipFile(P/(k+'.zip'))as old:
  with zipfile.ZipFile(P/(k+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),entries[e.filename].read_bytes()if e.filename in entries else old.read(e.filename))
   for name,path in entries.items():
    if name not in old.namelist():out.writestr(name,path.read_bytes())
  with zipfile.ZipFile(P/(k+'.candidate.zip'))as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in entries)
 raw=(P/(k+'.candidate.zip')).read_bytes();sha=base64.b64encode(hashlib.sha256(raw).digest()).decode();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=raw)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=cfg['FunctionName'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha
 for field in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','VpcConfig','Layers','Architectures']:assert cfg.get(field)==after.get(field),field
 report[k]={'function':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'codeSha256':sha,'changedFiles':list(entries),'configurationPreserved':True}
 if k=='financial':
  result=l.invoke(FunctionName=cfg['FunctionName'],Payload=json.dumps({'action':'staff_order_management','accessToken':'invalid','body':{'action':'READ','orderId':'order1'}}).encode());data=json.loads(result['Payload'].read());assert data.get('statusCode')==401,data
record={'status':'PUBLISHED_VERIFIED','functions':report,'realOrdersChanged':False,'financialWritesPerformed':False,'iamChanged':False};(P/'publication.json').write_text(json.dumps(record,indent=2));(R/'docs/order-management-publication-247.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
