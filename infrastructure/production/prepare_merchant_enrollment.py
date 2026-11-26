"""Deterministic enrollment artifact; does not activate or deploy any service."""
import hashlib, io, json, zipfile
from pathlib import Path
ROOT = Path(__file__).resolve().parent

def package():
    names = ['merchant-enrollment-runtime.cjs', 'merchant-enrollment.cjs',
             'merchant-enrollment-store.cjs', 'merchant-enrollment-identity.cjs',
             'merchant-login-proof.cjs', 'merchant-phone-binding.cjs']
    files = {n: (ROOT/'phone-auth'/n).read_bytes() for n in names}
    files['index.js'] = b"'use strict';\nexports.handler=require('./merchant-enrollment-runtime.cjs').handler;\n"
    for n in ['customer-legal-contract-344.js', 'customer-legal-defaults-344.json',
              'driver-legal-defaults-344.json', 'merchant-legal-defaults-344.json']:
        files[n] = (ROOT.parents[1]/'backend/shared'/n).read_bytes()
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, body in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026,1,1,0,0,0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, body)
    return out.getvalue()



def build():
    """Public bootstrap only; identity/profile and all operational APIs stay separate."""
    from prepare_merchant_profile import build as profile_template
    t = profile_template()
    t['Description'] = 'Production merchant phone enrollment bootstrap; initially disabled, no branch or financial access.'
    t['Parameters'].pop('ProfileApiEnabled', None)
    t['Parameters']['EnrollmentEnabled'] = {'Type':'String','Default':'false','AllowedValues':['false','true']}
    t['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-enrollment/[a-f0-9]{64}.zip'
    t['Parameters']['OtpSecretArn'] = {'Type':'String','AllowedPattern':r'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-[A-Za-z0-9]{6}'}
    r = t['Resources']
    for name in ['Authorizer','Profile','GETMethod','POSTMethod','GETInvoke','POSTInvoke']:
        del r[name]
    sub = lambda value: {'Fn::Sub':value}
    arn = lambda service, value: sub('arn:${AWS::Partition}:'+service+':${AWS::Region}:${AWS::AccountId}:'+value)
    r['LogGroup']['Properties']['LogGroupName'] = '/aws/lambda/wizz-production-merchant-enrollment'
    r['Role']['Properties']['Policies'] = [{'PolicyName':'MerchantEnrollmentOnly','PolicyDocument':{'Version':'2012-10-17','Statement':[
        {'Effect':'Allow','Action':['logs:CreateLogStream','logs:PutLogEvents'],'Resource':arn('logs','log-group:/aws/lambda/wizz-production-merchant-enrollment:*')},
        {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:PutItem','dynamodb:UpdateItem','dynamodb:ConditionCheckItem'],'Resource':arn('dynamodb','table/wizz-production-MerchantOtpSessions')},
        {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':arn('dynamodb','table/wizz-production-AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_LIFECYCLE#MERCHANT#*','MERCHANT_PHONE_CLOSURE#*']}}},
        {'Effect':'Allow','Action':['dynamodb:GetItem','dynamodb:ConditionCheckItem'],'Resource':arn('dynamodb','table/wizz-production-PlatformStaff'),'Condition':{'ForAllValues:StringEquals':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#MERCHANT_LEGAL']}}},
        {'Effect':'Allow','Action':['cognito-idp:ListUsers','cognito-idp:AdminCreateUser','cognito-idp:AdminGetUser','cognito-idp:AdminSetUserPassword'],'Resource':arn('cognito-idp','userpool/us-east-1_2sKZ4fGbZ')},
        {'Effect':'Allow','Action':['secretsmanager:GetSecretValue'],'Resource':{'Ref':'OtpSecretArn'}}
    ]}}]
    f = r['Function']['Properties']
    f['FunctionName'] = 'wizz-production-merchant-enrollment'
    f['Timeout'] = 25
    f['Environment']['Variables'] = {'ENVIRONMENT':'production','MERCHANT_ENROLLMENT_ENABLED':{'Ref':'EnrollmentEnabled'},'USER_POOL_ID':'us-east-1_2sKZ4fGbZ','USER_POOL_CLIENT_ID':'5l8ng11uudg146crop63926svq','OTP_TABLE':'wizz-production-MerchantOtpSessions','LEGAL_TABLE':'wizz-production-PlatformStaff','LIFECYCLE_TABLE':'wizz-production-AccountDeletion','OTP_SECRET_ARN':{'Ref':'OtpSecretArn'}}
    r['Api']['Properties']['Name'] = 'wizz-production-merchant-enrollment'
    def add(name, kind, properties):
        r[name] = {'Type':kind,'Condition':'IsProductionAccount','Properties':properties}
    add('Enrollment','AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':'Auth'},'PathPart':'merchant-enrollment'})
    methods=[]
    for path, method in [('legal','GET'),('send','POST'),('verify','POST')]:
        name=path.title()
        add(name,'AWS::ApiGateway::Resource',{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':'Enrollment'},'PathPart':path})
        add(name+'Method','AWS::ApiGateway::Method',{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':name},'HttpMethod':method,'AuthorizationType':'NONE','Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':sub('arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations')}})
        add(name+'Invoke','AWS::Lambda::Permission',{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':sub('arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+method+'/auth/merchant-enrollment/'+path)})
        methods.append(name+'Method')
    r['Deployment']['DependsOn']=methods
    r['Stage']['Properties']['MethodSettings'][0].update(ThrottlingBurstLimit=5,ThrottlingRateLimit=2)
    return t


if __name__ == '__main__':
    raw = package()
    digest = hashlib.sha256(raw).hexdigest()
    path = Path('/private/tmp/wizz-production-merchant-enrollment-'+digest+'.zip')
    path.write_bytes(raw)
    (ROOT/'merchant-enrollment-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print(json.dumps({'artifact':str(path),'sha256':digest,'status':'LOCAL_NOT_DEPLOYED'}))
