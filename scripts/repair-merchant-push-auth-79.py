"""Repair only Staging merchant pool/client configuration; preserve code and other environment values."""
import importlib.util,json,pathlib
R=pathlib.Path(__file__).resolve().parents[1]
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def main():
 s=m.session();l=s.client('lambda');c=s.client('cognito-idp');pool='us-east-1_gtCR3ndzT';client='4qabvh11nmghmf9fmc6e6ludd2'
 actual=c.describe_user_pool_client(UserPoolId=pool,ClientId=client)['UserPoolClient'];assert actual['UserPoolId']==pool
 out=pathlib.Path('/private/tmp/merchant-push-auth79');out.mkdir(exist_ok=True);result=[]
 for name in ['wizzcentral-notifications-staging-pushTokensRegister','wizzcentral-notifications-staging-pushTokensUnregister']:
  before=l.get_function_configuration(FunctionName=name);(out/(name+'.before.private.json')).write_text(json.dumps(before,default=str));env=dict(before['Environment']['Variables']);assert env['STAGE']=='staging'
  if env.get('MERCHANTS_USER_POOL_ID')==pool and env.get('MERCHANTS_CLIENT_ID')==client:result.append({'name':name,'alreadyConfigured':True});continue
  env.update(MERCHANTS_USER_POOL_ID=pool,MERCHANTS_CLIENT_ID=client)
  l.update_function_configuration(FunctionName=name,RevisionId=before['RevisionId'],Environment={'Variables':env});l.get_waiter('function_updated_v2').wait(FunctionName=name,WaiterConfig={'Delay':2,'MaxAttempts':60});after=l.get_function_configuration(FunctionName=name)
  assert after['CodeSha256']==before['CodeSha256'] and after['Role']==before['Role'] and after['Environment']['Variables']==env
  result.append({'name':name,'changedKeys':['MERCHANTS_USER_POOL_ID','MERCHANTS_CLIENT_ID'],'codeUnchanged':True,'roleUnchanged':True})
 (out/'result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result))
if __name__=='__main__':main()
