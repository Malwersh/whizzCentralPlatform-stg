"""Production driver phone enrollment, disabled pending activation gates."""
import json
from pathlib import Path
from prepare_customer_enrollment import build as customer
ROOT=Path(__file__).resolve().parent

def build():
 text=json.dumps(customer()).replace('customer-enrollment','driver-enrollment').replace('customer/otp','driver/otp').replace('CustomerEnrollmentOnly','DriverEnrollmentOnly').replace('us-east-1_rNtNKVsVf','us-east-1_5sUT54eCB').replace('CustomerPhoneAuth','DriverOtpSessions').replace('Customers','Drivers').replace('WALLET#CUSTOMER#','WALLET#DRIVER#').replace('ACCOUNT_LIFECYCLE#CUSTOMER#','ACCOUNT_LIFECYCLE#DRIVER#')
 t=json.loads(text);t['Description']='Driver enrollment API, OTP disabled pending acceptance; wallet binding independently controlled.'
 t['Parameters']['ArtifactKey']['AllowedPattern']='driver-enrollment/[a-f0-9]{64}.zip'
 t['Parameters']['OtpSecretArn']['AllowedPattern']='arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/driver/otp-[A-Za-z0-9]+'
 t['Parameters']['WalletBindingReady']={'Type':'String','Default':'false','AllowedValues':['false','true']}
 r=t['Resources'];statements=r['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement'];kept=[]
 for s in statements:
  a=s['Action'];resources=json.dumps(s['Resource'])
  if 'dynamodb:Query' in a or 'PlatformStaff' in resources:continue
  if 'DriverOtpSessions' in resources and a==['dynamodb:ConditionCheckItem']:continue
  if 'Wallets' in resources:s['Action']=['dynamodb:GetItem']
  if 'DriverOtpSessions' in resources:s['Action'].append('dynamodb:ConditionCheckItem')
  if any(x.startswith('cognito-idp:') for x in a):s['Action']=['cognito-idp:'+x for x in ['ListUsers','AdminCreateUser','AdminSetUserPassword','AdminUpdateUserAttributes']]
  if 'AccountDeletion' in resources:s['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys']=['ACCOUNT_LIFECYCLE#DRIVER#*','DRIVER_PHONE_CLOSURE#*']
  kept.append(s)
 kept.append({'Effect':'Allow','Action':['lambda:InvokeFunction'],'Resource':{'Fn::Sub':'arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:wizz-production-wallet-creation-trigger'}})
 r['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']=kept
 env=r['Function']['Properties']['Environment']['Variables']
 for k in ['CLIENT_ID','USERS_TABLE','LEGAL_SETTINGS_TABLE','DELETION_TABLE']:env.pop(k,None)
 env.update(DRIVER_TABLE='wizz-production-Drivers',WALLET_BINDING_READY={'Ref':'WalletBindingReady'})
 for n in ['LegalResource','LegalMethod','LegalInvoke']:r.pop(n)
 r['Deployment']['DependsOn']=['SendMethod','VerifyMethod']
 return t
if __name__=='__main__':(ROOT/'driver-enrollment.template.json').write_text(json.dumps(build(),indent=2)+'\n')
