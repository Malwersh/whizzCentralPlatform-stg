"""Resolve the user-selected test phone; read only. Private identity binding stays outside repo."""
import pathlib,json,importlib.util,decimal,argparse
R=pathlib.Path(__file__).resolve().parents[1];O=pathlib.Path('/private/tmp/finance85');O.mkdir(exist_ok=True,mode=0o700)
sp=importlib.util.spec_from_file_location('capture',R/'scripts/capture-financial-readers-63.py');m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def enc(x):return int(x) if isinstance(x,decimal.Decimal) and x%1==0 else float(x) if isinstance(x,decimal.Decimal) else str(x)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--phone',required=True);phone=parser.parse_args().phone;assert len(phone)==11 and phone.startswith('07') and phone.isdigit();international='+964'+phone[1:];s=m.session();db=s.resource('dynamodb');cog=s.client('cognito-idp');variants=[phone,international,international[1:],phone[1:]];identities={};matches={}
 for key,table,fields in [('customer','WizzUser_users_staging',['userId','id','cognitoSub','cognitoUserId','phone','phoneNumber','status']),('driver','WhizzDrivers_staging',['driverId','cognitoSub','cognitoUserId','userId','phone','phoneNumber','status','isActive'])]:
  values={':p'+str(i):v for i,v in enumerate(variants)};names={'#f'+str(i):v for i,v in enumerate(fields)};rows=[];cursor=None
  for _ in range(40):
   args={'FilterExpression':'phone IN ('+','.join(values)+') OR phoneNumber IN ('+','.join(values)+')','ExpressionAttributeValues':values,'ProjectionExpression':','.join(names),'ExpressionAttributeNames':names,'Limit':100}
   if cursor:args['ExclusiveStartKey']=cursor
   page=db.Table(table).scan(**args);rows+=page.get('Items',[]);cursor=page.get('LastEvaluatedKey')
   if not cursor:break
  assert not cursor,'INCOMPLETE_PHONE_LOOKUP';matches[key]=rows
 # Resolve verified subjects from configured Cognito pools rather than treating a profile ID as a subject.
 pools={}
 for key,fn in [('customer','WizzUser-CreateOrder-staging'),('driver','DriversApi-staging')]:
  e=s.client('lambda').get_function_configuration(FunctionName=fn).get('Environment',{}).get('Variables',{});pool=e.get('USER_POOL_ID') or e.get('COGNITO_USER_POOL_ID') or ('us-east-1_RGTqUXF5C' if key=='driver' else None);assert pool,'POOL_NOT_CONFIGURED '+key;pools[key]=pool
  assert 'stag' in cog.describe_user_pool(UserPoolId=pool)['UserPool']['Name'].lower(),'STAGING_POOL_REQUIRED'
  users=cog.list_users(UserPoolId=pool,Filter='phone_number = '+json.dumps(international),Limit=10).get('Users',[])
  assert len(users)==1,'UNIQUE_PHONE_IDENTITY_REQUIRED '+key
  u=users[0];attrs={a['Name']:a['Value'] for a in u['Attributes']};assert u['Enabled'] and u['UserStatus']=='CONFIRMED' and attrs.get('phone_number_verified')=='true','PHONE_ACCOUNT_NOT_READY '+key
  identities[key]={'subjectId':attrs['sub'],'poolId':pool,'enabled':True,'verifiedPhone':True}
 assert len(matches['driver'])==1 and len(matches['customer'])==1,'UNIQUE_PROFILE_REQUIRED'
 driver=matches['driver'][0];wallet=db.Table('staging-Wallets').get_item(Key={'walletId':'WALLET#DRIVER#'+driver['driverId'],'sk':'META'},ConsistentRead=True).get('Item');assert wallet,'DRIVER_WALLET_REQUIRED'
 p=O/'selected-identities.private.json';p.write_text(json.dumps({'identities':identities,'profiles':matches,'driverWallet':wallet},default=enc,indent=2));p.chmod(0o600)
 result={'customerMatched':True,'driverMatched':True,'verifiedPhoneAccounts':True,'driverWallet':{k:wallet.get(k) for k in ['status','currency','availableBalance','lockedBalance','version']},'readOnly':True};(O/'identity-readiness.json').write_text(json.dumps(result,default=enc,indent=2));print(json.dumps(result,default=enc))
if __name__=='__main__':main()
