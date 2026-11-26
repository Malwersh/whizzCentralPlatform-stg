"""Publish only reviewed Staging lock overlays; no campaign, consent, order or balance writes."""
import sys,json,pathlib,zipfile,copy,hashlib,base64,urllib.request
sys.path.insert(0,'/private/tmp/full-cash-208');from aws_session import session
O=pathlib.Path('/private/tmp/usage-limits-release');inv=json.loads((O/'inventory.private.json').read_text());changes=json.loads((O/'changes.json').read_text())
def passed(file,marker):assert marker in pathlib.Path(file).read_text(),file
for f,n in [('/private/tmp/usage-limits-staff-final.log','fail 0'),('/private/tmp/usage-limits-merchant-final2.log','fail 0'),('/private/tmp/usage-limits-actual-staff-tests2.log','fail 0'),('/private/tmp/usage-limits-actual-owner.log','"passed":true'),('/private/tmp/usage-limits-flutter-tests-final.log','All tests passed!'),('/private/tmp/usage-limits-customer-tests.log','fail 0')]:passed(f,n)
l=session().client('lambda');report={'status':'PUBLISHING','functions':[],'businessDataWritten':False,'humanConsentSubmitted':False,'financialWritesGranted':False}
for k in ['staff','auth','owner']:
 cfg=inv[k];name=cfg['FunctionName'];assert l.get_function_configuration(FunctionName=name)['RevisionId']==cfg['RevisionId'],'LIVE_DRIFT '+k
 with zipfile.ZipFile(O/(k+'.zip')) as old,zipfile.ZipFile(O/(k+'.candidate.zip'),'w',zipfile.ZIP_DEFLATED) as out:
  for item in old.infolist():out.writestr(copy.copy(item),(O/(k+'.changes')/item.filename).read_bytes() if item.filename in changes[k] else old.read(item.filename))
  for n in set(changes[k])-set(old.namelist()):out.writestr(n,(O/(k+'.changes')/n).read_bytes())
 with zipfile.ZipFile(O/(k+'.zip')) as old,zipfile.ZipFile(O/(k+'.candidate.zip')) as new:
  assert all(old.read(n)==new.read(n) for n in old.namelist() if n not in changes[k])
 data=(O/(k+'.candidate.zip')).read_bytes();l.update_function_code(FunctionName=name,RevisionId=cfg['RevisionId'],ZipFile=data);l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60})
 deployed=l.get_function(FunctionName=name);after=deployed['Configuration'];assert after['CodeSha256']==base64.b64encode(hashlib.sha256(data).digest()).decode()
 for key in ['Handler','Role','Runtime','Environment','MemorySize','Timeout','Layers','VpcConfig']:assert cfg.get(key)==after.get(key),('CONFIG_DRIFT',k,key)
 actual=O/(k+'.deployed.zip');actual.write_bytes(urllib.request.urlopen(deployed['Code']['Location'],timeout=60).read())
 with zipfile.ZipFile(actual) as actualZip,zipfile.ZipFile(O/(k+'.candidate.zip')) as expected:
  assert set(actualZip.namelist())==set(expected.namelist());assert all(actualZip.read(n)==expected.read(n) for n in expected.namelist())
 if k!='writer':
  path='/staff/offers' if k=='staff' else '/auth/commercial-agreements' if k=='auth' else '/discounts'
  result=l.invoke(FunctionName=name,Payload=json.dumps({'httpMethod':'GET','path':path,'headers':{}}).encode());body=json.loads(result['Payload'].read());assert not result.get('FunctionError') and body['statusCode']==401
 report['functions'].append({'function':name,'codeSha256':after['CodeSha256'],'changedEntries':changes[k],'allBytesVerified':True,'configurationPreserved':True});(O/'publication.json').write_text(json.dumps(report,indent=2));print(json.dumps({'published':k,'verified':True}),flush=True)
report['status']='PUBLISHED_VERIFIED';(O/'publication.json').write_text(json.dumps(report,indent=2));print(json.dumps({'passed':True,'functions':len(report['functions'])}),flush=True)
