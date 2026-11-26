"""Capture current code and prepare narrow commercial retention overlays. Staging only."""
import pathlib,json,hashlib,base64,urllib.request,zipfile,importlib.util,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[1];R=pathlib.Path('/private/tmp/finance61')
HOSTS={'expiry':'staging-account-deletion-financial-expiry','worker':'staging-account-deletion-worker','staff':'staging-wizz-staff-service'}
def sha(b):return base64.b64encode(hashlib.sha256(b).digest()).decode()
def main():
 import boto3
 R.mkdir(mode=0o700,exist_ok=True);assert not (R/'preparation.json').exists(),'ALREADY_PREPARED'
 creds=json.loads(subprocess.check_output(['aws','configure','export-credentials','--profile','Wizz_stg_UserApp','--format','process']));s=boto3.Session(aws_access_key_id=creds['AccessKeyId'],aws_secret_access_key=creds['SecretAccessKey'],aws_session_token=creds['SessionToken'],region_name='us-east-1');assert s.client('sts').get_caller_identity()['Account']=='699561669180';lam=s.client('lambda');base={}
 for kind,name in HOSTS.items():
  f=lam.get_function(FunctionName=name);cfg=f['Configuration'];data=urllib.request.urlopen(f['Code']['Location'],timeout=60).read();assert sha(data)==cfg['CodeSha256'];assert cfg['Runtime']=='nodejs22.x'
  (R/(kind+'.zip')).write_bytes(data);(R/(kind+'.config.private.json')).write_text(json.dumps(cfg));base[kind]={'name':name,'codeSha256':cfg['CodeSha256'],'revisionId':cfg['RevisionId'],'role':cfg['Role']}
 assert json.loads((R/'staff.config.private.json').read_text()).get('Environment',{}).get('Variables',{}).get('COMMERCIAL_ADMIN_ENABLED')!='true'
 spec=importlib.util.spec_from_file_location('overlay',ROOT/'scripts/prepare-central-pricing-release-56.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);packages={}
 for kind,names in {'expiry':['financial-purge.js','commercial-retention.js'],'worker':['merchant-worker.js','commercial-retention.js'],'staff':['commercial-management.js']}.items():
  folder=ROOT/'backend'/('staff-service' if kind=='staff' else 'account-deletion');changes={n:(folder/n).read_bytes() for n in names}
  with zipfile.ZipFile(R/(kind+'.zip')) as z:
   # Verify only the intended hook/adapter changed, retaining the existing live runtime.
   if kind=='worker':
    old=z.read('merchant-worker.js').decode();new=changes['merchant-worker.js'].decode();hook="await require('./commercial-retention').commercialRetention({db,r,job,requestTable,archiveTable});";assert new.replace(hook,'',1)==old,'WORKER_DRIFT'
   elif kind=='staff':
    old=z.read('commercial-management.js').decode();new=changes['commercial-management.js'].decode();a=old.index(' tx.push({Put:{TableName:P,Item:{...markerKey');b=old.index('\n',a);c=new.index(' const audit=ctx.audit(');d=new.index('\n',new.index(' tx.push({Put:{TableName:P,Item:{...markerKey',c));assert old[:a]==new[:c] and old[b:]==new[d:],'STAFF_DRIFT'
   else:
    # Only commercial source classes, their closure fences and full record CAS were added.
    assert z.read('cod-retention.js')==(folder/'cod-retention.js').read_bytes(),'COD_DEPENDENCY_DRIFT'
   if kind!='staff':assert z.read('policy.js')==(folder/'policy.js').read_bytes(),'POLICY_DRIFT'
  packages[kind]=m.archive(R/(kind+'.zip'),R/(kind+'.candidate.zip'),changes)
 def statement(actions,table,keys=None):
  x={'Effect':'Allow','Action':['dynamodb:'+a for a in actions],'Resource':'arn:aws:dynamodb:us-east-1:699561669180:table/'+table}
  if keys:x['Condition']={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':keys}}
  return x
 docs={
 'worker':{'Version':'2012-10-17','Statement':[statement(['GetItem','Query','ConditionCheckItem'],'staging-PlatformStaff',['COMMERCIAL_AGREEMENT#*','DISCOUNT_FUNDING#*']),statement(['GetItem','DeleteItem','ConditionCheckItem'],'staging-PlatformStaff',['AUDIT'])]},
 'expiry':{'Version':'2012-10-17','Statement':[statement(['GetItem','DeleteItem','ConditionCheckItem'],'staging-MerchantPlatform',['COMMERCIAL_AGREEMENT#*']),statement(['GetItem','DeleteItem','ConditionCheckItem'],'staging-PlatformStaff',['COMMERCIAL_AGREEMENT#*','DISCOUNT_FUNDING#*','AUDIT']),statement(['GetItem','ConditionCheckItem'],'WhizzMerchants_Businesses'),statement(['GetItem','ConditionCheckItem'],'staging-AccountDeletion',['BUSINESS_LIFECYCLE#MERCHANT#*','SUBJECT#MERCHANT#*']),statement(['GetItem','ConditionCheckItem'],'staging-Wallets',['WALLET#MERCHANT#*'])]}}
 template={'AWSTemplateFormatVersion':'2010-09-09','Description':'Scoped commercial retention access for existing Staging deletion workers; no execution flags changed.','Conditions':{'StagingAccountAndRegion':{'Fn::And':[{'Fn::Equals':[{'Ref':'AWS::AccountId'},'699561669180']},{'Fn::Equals':[{'Ref':'AWS::Region'},'us-east-1']}]}},'Resources':{}}
 for kind,doc in docs.items():template['Resources'][kind.title()+'CommercialRetention']={'Type':'AWS::IAM::Policy','Condition':'StagingAccountAndRegion','Properties':{'PolicyName':'CommercialRetention61'+kind.title(),'Roles':[base[kind]['role'].rsplit('/',1)[1]],'PolicyDocument':doc}}
 (ROOT/'backend/finance-commercial-retention-access.staging.json').write_text(json.dumps(template,indent=2)+'\n')
 manifest={'part':61,'base':base,'packages':packages,'activationPerformed':False};(R/'preparation.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest))
if __name__=='__main__':main()
