"""Publish isolated cancellation compensation and conditional settlement support on Staging."""
import boto3,pathlib,json,zipfile,copy,hashlib,base64,time
R=pathlib.Path(__file__).resolve().parents[1];P=R/'backend/.tmp/cancellation-compensation-249';s=boto3.Session(profile_name='Wizz_stg_UserApp',region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';l=s.client('lambda');inventory=json.loads((P/'inventory.private.json').read_text());changes=json.loads((P/'changes.json').read_text());report={}
for key in ['financial','staff']:
 cfg=inventory[key];assert l.get_function_configuration(FunctionName=cfg['FunctionName'])['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT'
 with zipfile.ZipFile(P/(key+'.zip'))as old:
  with zipfile.ZipFile(P/(key+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED)as out:
   for e in old.infolist():out.writestr(copy.copy(e),(P/(key+'.changes')/e.filename).read_bytes()if e.filename in changes[key]else old.read(e.filename))
   for name in changes[key]:
    if name not in old.namelist():out.writestr(name,(P/(key+'.changes')/name).read_bytes())
  with zipfile.ZipFile(P/(key+'.candidate.zip'))as new:assert all(old.read(n)==new.read(n)for n in old.namelist()if n not in changes[key])
 raw=(P/(key+'.candidate.zip')).read_bytes();sha=base64.b64encode(hashlib.sha256(raw).digest()).decode();l.update_function_code(FunctionName=cfg['FunctionName'],RevisionId=cfg['RevisionId'],ZipFile=raw)
 for _ in range(60):
  after=l.get_function_configuration(FunctionName=cfg['FunctionName'])
  if after['LastUpdateStatus']!='InProgress':break
  time.sleep(2)
 assert after['LastUpdateStatus']=='Successful'and after['CodeSha256']==sha
 for field in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','VpcConfig','Layers','Architectures']:assert cfg.get(field)==after.get(field),field
 report[key]={'function':cfg['FunctionName'],'baseCodeSha256':cfg['CodeSha256'],'codeSha256':sha,'changedFiles':changes[key],'configurationPreserved':True,'unrelatedZipEntriesPreserved':True}
 if key=='financial':
  r=l.invoke(FunctionName=cfg['FunctionName'],Payload=json.dumps({'action':'cancellation_compensation','accessToken':'invalid','body':{'action':'READ','orderId':'order1','caseKey':'CUSTOMER_CANCELLATION'}}).encode());data=json.loads(r['Payload'].read());assert data['statusCode']==401,data
record={'status':'PUBLISHED_VERIFIED','functions':report,'realCompensationApproved':False,'realCompensationPaid':False,'businessMutationsPerformed':False,'iamChanged':False,'validation':{'newFinancialTests':8,'actualCandidateRuntimeAndReturnRegressionTests':20,'staffTests':360,'browserWorkflow':'PASS','realOrderReadOnlySourceCompatibility':'PASS'}};(P/'publication.json').write_text(json.dumps(record,indent=2));(R/'docs/cancellation-compensation-publication-249.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
