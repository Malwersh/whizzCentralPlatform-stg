"""Publish verified narrow Staging overlays, without enabling schedule creation."""
import pathlib,json,importlib.util,base64,hashlib,datetime
ROOT=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance113')
def digest(data):return base64.b64encode(hashlib.sha256(data).digest()).decode()
def main():
 assert (O/'permission-publication.json').exists(),'REVIEWED_PERMISSION_NOT_APPLIED';permission=json.loads((O/'permission-publication.json').read_text());assert permission.get('appliedAt')
 preparation=json.loads((O/'preparation.json').read_text());assert json.loads((O/'dynamodb-verification.json').read_text())['temporaryTableDeleted'];assert json.loads((O/'package-verification.json').read_text())['existingPermissionCatalogMatched']
 spec=importlib.util.spec_from_file_location('capture',ROOT/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);s=m.session();lam=s.client('lambda');iam=s.client('iam')
 reviewed=json.loads((ROOT/'backend/finance-settlement-retention-access.staging.json').read_text());assert iam.get_role_policy(RoleName=reviewed['targetRole'].rsplit('/',1)[1],PolicyName=reviewed['policyName'])['PolicyDocument']==reviewed['policyDocument']
 assert not (O/'code-publication.json').exists(),'PUBLICATION_ALREADY_STARTED';rows=[]
 # All bases must still match before the first mutation.
 for label in ['expiry','worker','staff','merchant']:
  old=preparation['base'][label];cfg=lam.get_function_configuration(FunctionName=old['name']);assert cfg['CodeSha256']==old['codeSha256'] and cfg['RevisionId']==old['revisionId'],'LIVE_DRIFT '+label
  assert cfg.get('Environment',{}).get('Variables',{}).get('SETTLEMENT_SCHEDULE_ADMIN_ENABLED')!='true','SCHEDULE_GATE_ALREADY_OPEN'
 for label in ['expiry','worker','staff','merchant']:
  old=preparation['base'][label];payload=(O/(label+'.candidate.zip')).read_bytes();assert digest(payload)==preparation['packages'][label]['codeSha256']
  out=lam.update_function_code(FunctionName=old['name'],ZipFile=payload,RevisionId=old['revisionId'],Publish=False)
  lam.get_waiter('function_updated_v2').wait(FunctionName=old['name'],WaiterConfig={'Delay':2,'MaxAttempts':30})
  cfg=lam.get_function_configuration(FunctionName=old['name']);before=json.loads((O/(label+'.config.private.json')).read_text())
  assert cfg['CodeSha256']==digest(payload) and cfg['LastUpdateStatus']=='Successful';assert cfg.get('Environment',{})==before.get('Environment',{}),'ENVIRONMENT_CHANGED'
  assert all(cfg.get(k)==before.get(k) for k in ['Role','Runtime','Handler','MemorySize','Timeout','VpcConfig','Layers'])
  rows.append({'host':label,'name':old['name'],'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'configurationPreserved':True,'scheduleGateEnabled':False})
  (O/'code-publication.json').write_text(json.dumps({'publishedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'functions':rows,'activation':False},indent=2));(O/'code-publication.json').chmod(0o600)
  print(json.dumps({'published':label,'scheduleGateEnabled':False}),flush=True)
if __name__=='__main__':main()
