"""Keep direct authorization compatible with the existing strict commercial reader; audit metadata stays in audit."""
import pathlib,json,importlib.util,zipfile,copy,urllib.request,hashlib,base64,difflib
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance67');sp=importlib.util.spec_from_file_location('c',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 assert 'pass 187' in (O/'unit-tests.log').read_text() and 'fail 0' in (O/'unit-tests.log').read_text();s=m.session();lam=s.client('lambda');f=lam.get_function(FunctionName='staging-wizz-staff-service');old=f['Configuration'];base=urllib.request.urlopen(f['Code']['Location'],timeout=90).read();assert sha(base)==old['CodeSha256'];(O/'staff.contract.base.zip').write_bytes(base);(O/'staff.contract.config.private.json').write_text(json.dumps(old));candidate=(R/'backend/staff-service/commercial-management.js').read_bytes()
 with zipfile.ZipFile(O/'staff.contract.base.zip') as z:
  diff=list(difflib.unified_diff(z.read('commercial-management.js').decode().splitlines(),candidate.decode().splitlines(),'live','candidate',n=2));assert len(diff)<30,'UNEXPECTED_CONTRACT_DIFF';(O/'commercial-contract.diff').write_text('\n'.join(diff))
  with zipfile.ZipFile(O/'staff.contract.candidate.zip','w',zipfile.ZIP_DEFLATED) as out:
   for info in z.infolist():out.writestr(copy.copy(info),candidate if info.filename=='commercial-management.js' else z.read(info.filename))
  with zipfile.ZipFile(O/'staff.contract.candidate.zip') as out:assert all(out.read(n)==z.read(n) for n in z.namelist() if n!='commercial-management.js')
 data=(O/'staff.contract.candidate.zip').read_bytes();lam.update_function_code(FunctionName=old['FunctionName'],RevisionId=old['RevisionId'],ZipFile=data);lam.get_waiter('function_updated_v2').wait(FunctionName=old['FunctionName'],WaiterConfig={'Delay':2,'MaxAttempts':90});new=lam.get_function_configuration(FunctionName=old['FunctionName']);assert new['CodeSha256']==sha(data)
 for name in ['Environment','Role','Runtime','Handler','Timeout','MemorySize','Layers','VpcConfig','Architectures']:assert new.get(name)==old.get(name)
 p=json.loads((O/'publication.json').read_text());p['functions'].append({'name':new['FunctionName'],'codeSha256':new['CodeSha256'],'revisionId':new['RevisionId'],'configurationPreserved':True,'changedFiles':['commercial-management.js'],'strictCommercialReaderContractPreserved':True});(O/'publication.json').write_text(json.dumps(p,indent=2))
 table=s.resource('dynamodb').Table('staging-PlatformStaff');cursor=None;found=[]
 for _ in range(20):
  page=table.scan(ConsistentRead=True,Limit=200,ProjectionExpression='pk,sk,#m',FilterExpression='begins_with(pk,:pk) AND begins_with(sk,:sk) AND #m=:direct',ExpressionAttributeNames={'#m':'writeMode'},ExpressionAttributeValues={':pk':'COMMERCIAL_AGREEMENT#',':sk':'APPROVAL#',':direct':'DIRECT'},**({'ExclusiveStartKey':cursor} if cursor else {}));found.extend(page.get('Items',[]));cursor=page.get('LastEvaluatedKey')
  if not cursor:break
 assert not cursor,'CONTRACT_AUDIT_INCOMPLETE';p['directApprovalExtraFieldCount']=len(found);p['contractAuditComplete']=True;(O/'publication.json').write_text(json.dumps(p,indent=2));assert not found,'EXISTING_DIRECT_RECORD_REQUIRES_REVIEW';print(json.dumps({'strictAgreementContractPreserved':True,'existingIncompatibleApprovalRows':len(found),'financialActivation':False}))
if __name__=='__main__':main()
