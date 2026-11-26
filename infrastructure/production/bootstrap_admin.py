"""One-time, audited production owner invitation. Never prints passwords or copies identities."""
import argparse,json,uuid
from datetime import datetime,timezone
from pathlib import Path
ACCOUNT='746727375268';POOL='us-east-1_njh6vaNWj';TABLE='wizz-production-PlatformStaff';EMAIL='moh.al.daash@gmail.com'

def records(subject,actor,now):
 if not subject or not actor.startswith('arn:aws:sts::'+ACCOUNT+':'):raise ValueError('Invalid production identity')
 profile={'pk':'EMPLOYEE#'+subject,'sk':'PROFILE','employeeId':subject,'email':EMAIL,'name':'مالك منصة الإنتاج','status':'INVITED','version':1,'activationApproved':True,'roles':['bootstrap_admin'],'scope':{'allRegions':True,'regionIds':[]},'approvalLimit':0,'mfaRequired':True,'createdAt':now,'reason':'Initial production owner explicitly selected by the account owner; operational activation requires MFA.'}
 marker={'pk':'BOOTSTRAP#ADMIN','sk':'INITIAL_OWNER','employeeId':subject,'email':EMAIL,'createdAt':now}
 audit={'pk':'AUDIT','sk':now+'#INITIAL_OWNER','schemaVersion':2,'action':'PRODUCTION_OWNER_INVITED','actorId':actor,'actorIdentityEvidence':'AWS_STS_CALLER_AT_ACTION','createdAt':now,'before':None,'after':profile,'reason':profile['reason'],'outcome':'INVITED_PENDING_MFA'}
 return profile,marker,audit

def run(evidence_path):
 import boto3
 from boto3.dynamodb.types import TypeSerializer
 s=boto3.Session(profile_name='Wizz_prod_UserApp',region_name='us-east-1');who=s.client('sts').get_caller_identity();assert who['Account']==ACCOUNT
 c=s.client('cognito-idp');table=s.resource('dynamodb').Table(TABLE)
 if table.get_item(Key={'pk':'BOOTSTRAP#ADMIN','sk':'INITIAL_OWNER'},ConsistentRead=True).get('Item'):raise RuntimeError('Bootstrap already recorded; use the reviewed recovery path, never create another owner')
 if c.list_users(UserPoolId=POOL,Limit=1)['Users']:raise RuntimeError('Admin pool is not empty; review existing identities first')
 if table.scan(Limit=1,ProjectionExpression='pk')['Items']:raise RuntimeError('Staff table is not empty; review before bootstrap')
 # SUPPRESS ensures the invitation is not sent before the audited profile exists.
 r=c.admin_create_user(UserPoolId=POOL,Username=EMAIL,UserAttributes=[{'Name':'email','Value':EMAIL}],MessageAction='SUPPRESS')
 user=r['User'];subject=next(a['Value'] for a in user['Attributes'] if a['Name']=='sub');now=datetime.now(timezone.utc).isoformat();items=records(subject,who['Arn'],now);serializer=TypeSerializer()
 evidence={'accountId':ACCOUNT,'email':EMAIL,'employeeId':subject,'username':user['Username'],'status':'IDENTITY_CREATED_INVITATION_NOT_SENT','createdAt':now,'actorArn':who['Arn'],'mfaCompleted':False,'operationalActivationCompleted':False}
 path=Path(evidence_path);path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
 s.client('dynamodb').transact_write_items(TransactItems=[{'Put':{'TableName':TABLE,'Item':{k:serializer.serialize(v) for k,v in item.items()},'ConditionExpression':'attribute_not_exists(pk) AND attribute_not_exists(sk)'}} for item in items])
 evidence['status']='AUDITED_PROFILE_CREATED';path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n')
 c.admin_create_user(UserPoolId=POOL,Username=EMAIL,DesiredDeliveryMediums=['EMAIL'],MessageAction='RESEND')
 evidence['status']='INVITATION_SENT_PENDING_PASSWORD_AND_MFA';path.write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'email':EMAIL,'status':evidence['status'],'passwordPrinted':False}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--execute',action='store_true');p.add_argument('--evidence',required=True);a=p.parse_args()
 if not a.execute:raise SystemExit('Explicit --execute required for initial owner invitation')
 run(a.evidence)
