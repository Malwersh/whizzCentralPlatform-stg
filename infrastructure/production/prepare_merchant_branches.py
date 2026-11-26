"""Generate an isolated, disabled branch-draft API; never deploy implicitly."""
import json
from pathlib import Path
from prepare_merchant_profile import build as profile_template
ROOT = Path(__file__).resolve().parent

def build():
    t = profile_template()
    t['Description'] = 'Production merchant branch drafts; verified identity, regional and asset transaction fences; initially disabled.'
    t['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-branches/[a-f0-9]{64}.zip'
    r = t['Resources']
    log = '/aws/lambda/wizz-production-merchant-branches'
    r['LogGroup']['Properties']['LogGroupName'] = log
    role = r['Role']['Properties']['Policies'][0]
    role['PolicyName'] = 'MerchantBranchDraftsOnly'
    statements = role['PolicyDocument']['Statement']
    statements[0]['Resource']['Fn::Sub'] = 'arn:${AWS::Partition}:logs:${AWS::Region}:${AWS::AccountId}:log-group:' + log + ':*'
    statements[2]['Action'] = ['dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:PutItem', 'dynamodb:ConditionCheckItem']
    statements[2]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'].append('REVIEW#MERCHANT')
    statements[4]['Condition']['ForAllValues:StringEquals']['dynamodb:LeadingKeys'] = ['OPERATIONAL_SETTINGS#MERCHANT_ONBOARDING']
    def table(name):
        return {'Fn::Sub': 'arn:${AWS::Partition}:dynamodb:${AWS::Region}:${AWS::AccountId}:table/wizz-production-' + name}
    statements.append({'Effect':'Allow', 'Action':['dynamodb:GetItem','dynamodb:Query','dynamodb:ConditionCheckItem'], 'Resource':[table('Regions'),table('RegionsDerived'),table('RegionIndex'),table('RegionIndex/index/h3-index')]})
    bucket='wizz-production-merchant-onboarding-746727375268'
    r['AssetsBucket']={'Type':'AWS::S3::Bucket','Condition':'IsProductionAccount','DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain','Properties':{'BucketName':bucket,'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},'VersioningConfiguration':{'Status':'Enabled'},'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,'BlockPublicPolicy':True,'RestrictPublicBuckets':True},'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]}}}
    r['AssetsBucketPolicy']={'Type':'AWS::S3::BucketPolicy','Condition':'IsProductionAccount','Properties':{'Bucket':{'Ref':'AssetsBucket'},'PolicyDocument':{'Version':'2012-10-17','Statement':[{'Effect':'Deny','Principal':'*','Action':'s3:*','Resource':['arn:aws:s3:::'+bucket,'arn:aws:s3:::'+bucket+'/*'],'Condition':{'Bool':{'aws:SecureTransport':'false'}}}]}}}
    statements.append({'Effect':'Allow','Action':['s3:GetObject','s3:PutObject'],'Resource':'arn:aws:s3:::'+bucket+'/persons/*'})
    statements.append({'Effect':'Allow','Action':['dynamodb:PutItem','dynamodb:DeleteItem'],'Resource':table('AccountDeletion'),'Condition':{'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['ACCOUNT_OPERATION#MERCHANT#*']}}})
    f = r['Function']['Properties']
    f['FunctionName'] = 'wizz-production-merchant-branches'
    f['Timeout'] = 25
    f['Environment']['Variables'] = {'ENVIRONMENT':'production','BRANCH_API_ENABLED':'false'}
    r['Api']['Properties']['Name'] = 'wizz-production-merchant-branches'
    for key in ['Profile','GETMethod','POSTMethod','GETInvoke','POSTInvoke']:
        del r[key]
    statements.append({'Effect':'Allow','Action':['dynamodb:Query'],'Resource':table('Merchants/index/ownerId-index')})
    # Lambda uses its execution identity, so subject authorization is enforced by authenticated code.
    statements.append({'Effect':'Allow','Action':['dynamodb:GetItem'],'Resource':table('Merchants')})
    methods = []
    for name, part, parent, verbs in [('Businesses','user-businesses','Auth',['GET']),('Drafts','branch-drafts','Auth',['GET','POST']),('Assets','assets','Drafts',['GET','POST']),('Config','config','Drafts',['GET']),('Submit','submit','Drafts',['POST']),('Rebase','rebase','Drafts',['POST'])]:
        r[name] = {'Type':'AWS::ApiGateway::Resource','Condition':'IsProductionAccount','Properties':{'RestApiId':{'Ref':'Api'},'ParentId':{'Ref':parent},'PathPart':part}}
        path = '/auth/user-businesses' if name == 'Businesses' else '/auth/branch-drafts' + ('' if name == 'Drafts' else '/' + part)
        for verb in verbs:
            key = name + verb
            methods.append(key)
            r[key] = {'Type':'AWS::ApiGateway::Method','Condition':'IsProductionAccount','Properties':{'RestApiId':{'Ref':'Api'},'ResourceId':{'Ref':name},'HttpMethod':verb,'AuthorizationType':'COGNITO_USER_POOLS','AuthorizerId':{'Ref':'Authorizer'},'Integration':{'Type':'AWS_PROXY','IntegrationHttpMethod':'POST','Uri':{'Fn::Sub':'arn:${AWS::Partition}:apigateway:${AWS::Region}:lambda:path/2015-03-31/functions/${Function.Arn}/invocations'}}}}
            r[key+'Invoke'] = {'Type':'AWS::Lambda::Permission','Condition':'IsProductionAccount','Properties':{'Action':'lambda:InvokeFunction','FunctionName':{'Ref':'Function'},'Principal':'apigateway.amazonaws.com','SourceAccount':{'Ref':'AWS::AccountId'},'SourceArn':{'Fn::Sub':'arn:${AWS::Partition}:execute-api:${AWS::Region}:${AWS::AccountId}:${Api}/production/'+verb+path}}}
    r['Deployment']['DependsOn'] = methods
    r['AssetsDeploymentV1'] = r.pop('Deployment')
    r['Stage']['Properties']['DeploymentId'] = {'Ref':'AssetsDeploymentV1'}
    return t

if __name__ == '__main__':
    (ROOT/'merchant-branches-api.template.json').write_text(json.dumps(build(),indent=2)+'\n')
    print('Prepared disabled branch API template; not deployed.')
