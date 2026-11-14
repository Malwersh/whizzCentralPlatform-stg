"""Add support references to the existing service; preserve all unrelated live files."""
import pathlib,json,importlib.util,urllib.request,zipfile,copy,hashlib,base64,difflib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/reference72');O.mkdir(exist_ok=True);sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 assert json.loads((O/'live-test.json').read_text())['isolatedTableDeleted'];s=m.session();l=s.client('lambda');name='staging-wizz-staff-service';f=l.get_function(FunctionName=name);cfg=f['Configuration'];blob=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();(O/'staff.base.zip').write_bytes(blob);(O/'staff.config.private.json').write_text(json.dumps(cfg));changes={n:(R/'backend/staff-service'/n).read_bytes() for n in ['commercial-management.js','commercial-reference.js']}
 with zipfile.ZipFile(O/'staff.base.zip') as old:
  if 'commercial-reference.js' in old.namelist():
   previous=json.loads((O/'publication.json').read_text());assert previous['afterSha256']==cfg['CodeSha256'],'LIVE_REFERENCE_DRIFT'
   with zipfile.ZipFile(O/'staff.candidate.zip') as prior:assert old.read('commercial-reference.js')==prior.read('commercial-reference.js')
   assert old.read('commercial-management.js')==changes['commercial-management.js']
  else:
   with zipfile.ZipFile('/private/tmp/finance67/staff.contract.candidate.zip') as prior:assert old.read('commercial-management.js')==prior.read('commercial-management.js'),'LIVE_COMMERCIAL_DRIFT'
  diff=list(difflib.unified_diff(old.read('commercial-management.js').decode().splitlines(),changes['commercial-management.js'].decode().splitlines(),n=1));assert len(diff)<65;(O/'staff.diff').write_text('\n'.join(diff))
  with zipfile.ZipFile(O/'staff.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in old.infolist():out.writestr(copy.copy(info),changes.get(info.filename,old.read(info.filename)))
   if 'commercial-reference.js' not in old.namelist():out.writestr('commercial-reference.js',changes['commercial-reference.js'])
  with zipfile.ZipFile(O/'staff.candidate.zip') as out:assert all(out.read(n)==old.read(n) for n in old.namelist() if n not in changes)
 # Verify existing exact resource permissions; do not grant broader rights.
 role=cfg['Role'];iam=s.client('iam');sim=iam.simulate_principal_policy(PolicySourceArn=role,ActionNames=['dynamodb:GetItem','dynamodb:PutItem'],ResourceArns=['arn:aws:dynamodb:us-east-1:699561669180:table/staging-PlatformStaff','arn:aws:dynamodb:us-east-1:699561669180:table/staging-MerchantPlatform']);assert all(x['EvalDecision']=='allowed' for x in sim['EvaluationResults'])
 live=l.get_function_configuration(FunctionName=name);assert live['RevisionId']==cfg['RevisionId'];payload=(O/'staff.candidate.zip').read_bytes();l.update_function_code(FunctionName=name,ZipFile=payload,RevisionId=cfg['RevisionId']);l.get_waiter('function_updated_v2').wait(FunctionName=name);after=l.get_function_configuration(FunctionName=name);assert after['CodeSha256']==base64.b64encode(hashlib.sha256(payload).digest()).decode();assert after['Environment']==cfg['Environment'];result={'name':name,'beforeSha256':cfg['CodeSha256'],'afterSha256':after['CodeSha256'],'changedFiles':list(changes),'configurationPreserved':True,'iamChanged':False,'permissionChecks':len(sim['EvaluationResults']),'financialActivation':False};
 if (O/'ui-publication.json').exists():result['amplify']=json.loads((O/'ui-publication.json').read_text())
 (O/'publication.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
