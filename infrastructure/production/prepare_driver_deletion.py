"""Build production driver deletion packages and CloudFormation templates."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
SOURCE = ROOT / 'account-deletion'
ARTIFACTS = 'wizz-production-artifacts-746727375268-us-east-1'


def arn(service, resource):
    return {'Fn::Sub': f'arn:${{AWS::Partition}}:{service}:${{AWS::Region}}:${{AWS::AccountId}}:{resource}'}


def tables(names):
    return [arn('dynamodb', 'table/wizz-production-' + name) for name in names.split()]


def allow(actions, resources, keys=None):
    row = {'Effect': 'Allow', 'Action': actions.split(), 'Resource': resources}
    if keys:
        row['Condition'] = {'ForAllValues:StringLike': {'dynamodb:LeadingKeys': keys}}
    return row


def worker_policy():
    return [
        allow('dynamodb:GetItem dynamodb:Scan dynamodb:Query', tables(
            'AccountDeletion Drivers Wallets Holds Orders WaveOffers WalletLifecycle DispatchJobs '
            'TopupRequests IdempotencyKeys LedgerEntries AuditLog PushDeviceTokens DriverLiveState '
            'OrderConnections WalletNotifications SupportChatSessions OrderRatings DriverPerformanceSnapshots '
            'DriverOtpSessions AccountDeletionFinancialArchive MerchantPlatform')),
        allow('dynamodb:ConditionCheckItem', tables(
            'AccountDeletion Drivers Wallets Holds Orders WaveOffers WalletLifecycle DispatchJobs '
            'LedgerEntries AuditLog TopupRequests IdempotencyKeys OrderConnections AccountDeletionFinancialArchive MerchantPlatform')),
        allow('dynamodb:Scan', tables('PlatformStaff')),
        allow('dynamodb:GetItem dynamodb:ConditionCheckItem', tables('PlatformStaff'), ['OPERATIONAL_SETTINGS#ACCOUNT_DELETION']),
        allow('dynamodb:UpdateItem', tables('Drivers Orders WaveOffers AuditLog')),
        allow('dynamodb:UpdateItem', tables('Wallets'), ['WALLET#DRIVER#*']),
        allow('dynamodb:PutItem dynamodb:UpdateItem', tables('AccountDeletion'), [
            'SUBJECT#DRIVER#*','ACCOUNT_LIFECYCLE#DRIVER#*','DRIVER_PHONE_CLOSURE#*','SCHEDULER#DRIVER']),
        allow('dynamodb:DeleteItem', tables('AccountDeletion'), ['DRIVER_PHONE_CLOSURE#*']),
        allow('dynamodb:PutItem', tables('AccountDeletionFinancialArchive'), ['REQUEST#*']),
        allow('dynamodb:DeleteItem', tables(
            'Drivers DriverLiveState PushDeviceTokens OrderConnections WalletNotifications DriverOtpSessions DriverPerformanceSnapshots')),
        allow('cognito-idp:AdminGetUser cognito-idp:AdminDisableUser cognito-idp:AdminUserGlobalSignOut cognito-idp:AdminDeleteUser',
            arn('cognito-idp','userpool/us-east-1_5sUT54eCB')),
        {'Effect':'Allow','Action':['s3:ListBucket','s3:ListBucketVersions'],
            'Resource':'arn:aws:s3:::wizz-production-driver-documents-746727375268-us-east-1',
            'Condition':{'StringLike':{'s3:prefix':'drivers/*'}}},
        {'Effect':'Allow','Action':'s3:DeleteObjectVersion',
            'Resource':'arn:aws:s3:::wizz-production-driver-documents-746727375268-us-east-1/drivers/*'},
        allow('execute-api:ManageConnections', arn('execute-api','${OrderSocketId}/production/DELETE/@connections/*')),
    ]


def build_worker():
    t = json.loads((SOURCE / 'worker-disabled.template.json').read_text().replace(
        'wizz-production-customer-deletion', 'wizz-production-driver-deletion'))
    t['Description'] = 'Production driver deletion worker and an independently controlled retry schedule.'
    t['Parameters']['ArtifactKey']['AllowedPattern'] = 'driver-deletion/[a-f0-9]{64}[.]zip'
    t['Parameters']['OrderSocketId'] = t['Parameters'].pop('SupportSocketId')
    props = t['Resources']['Worker']['Properties']
    props['Timeout'] = 300
    env = props['Environment']['Variables']
    env['DRIVER_DELETION_ENABLED'] = env.pop('CUSTOMER_DELETION_ENABLED')
    env.pop('DELIVERY_FUNDING_ARCHIVE_ENABLED')
    env.pop('SUPPORT_SOCKET_ENDPOINT')
    env['ORDER_SOCKET_ENDPOINT'] = {'Fn::Sub':'https://${OrderSocketId}.execute-api.${AWS::Region}.amazonaws.com/production'}
    t['Resources']['RetrySchedule']['Properties']['Targets'][0]['Input'] = '{"operation":"DRIVER_DELETION_SWEEP"}'
    role = t['Resources']['WorkerRole']['Properties']
    role['Policies'][1] = {'PolicyName':'DriverDeletionResources',
        'PolicyDocument':{'Version':'2012-10-17','Statement':worker_policy()}}
    return t


def build_intake():
    t = json.loads((SOURCE / 'intake.template.json').read_text().replace(
        'wizz-production-customer-deletion-intake','wizz-production-driver-deletion-intake'))
    t['Description'] = 'Driver-only production deletion request API.'
    t['Parameters']['OtpSecretArn']['AllowedPattern'] = 'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/driver/otp-[A-Za-z0-9]+'
    t['Parameters']['ArtifactKey']['AllowedPattern'] = 'driver-deletion-intake/[a-f0-9]{64}[.]zip'
    env = t['Resources']['Function']['Properties']['Environment']['Variables']
    env['ACCOUNT_DELETION_ACTOR_TYPE'] = 'DRIVER'
    env['DRIVER_DELETION_INTAKE_ENABLED'] = env.pop('CUSTOMER_DELETION_INTAKE_ENABLED')
    env.pop('DELIVERY_FUNDING_ARCHIVE_ENABLED')
    rows=t['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
    result=[]
    for row in rows:
        resource=json.dumps(row['Resource'])
        if 'PlatformStaff' in resource and row['Action']==['dynamodb:GetItem']:
            row['Condition']={'ForAllValues:StringLike':{'dynamodb:LeadingKeys':['OPERATIONAL_SETTINGS#ACCOUNT_DELETION']}}
        if 'DELIVERY_RESERVATION#' in json.dumps(row):
            continue
        if 'OfferJourney' in resource:
            continue
        result.append(json.loads(json.dumps(row).replace('/wizz-production-Customers','/wizz-production-Drivers')
            .replace('WALLET#CUSTOMER#','WALLET#DRIVER#').replace('#CUSTOMER#','#DRIVER#')))
    result.extend([
        allow('dynamodb:Scan',tables('WaveOffers OrderRatings')),
        allow('dynamodb:Query',tables('DriverPerformanceSnapshots'),['DRIVER#*']),
        allow('dynamodb:Query',tables('AccountDeletion'),['ACCOUNT_OPERATION#DRIVER#*']),
        allow('dynamodb:GetItem',tables('IdempotencyKeys'),['ZC#ACTIVE#*']),
    ])
    t['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']=result
    return t


def write_package(out, name, entry, template):
    data = subprocess.check_output([
        str(REPO / 'backend/wallet-service/node_modules/.bin/esbuild'), str(SOURCE / entry),
        '--bundle','--platform=node','--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*',
    ], cwd=REPO)
    bundle=out/(name+'.zip')
    with ZipFile(bundle,'w') as archive:
        archive.writestr(ZipInfo(('intake' if name.endswith('-intake') else 'worker')+'.js',
            (2026,1,1,0,0,0)),data,compress_type=ZIP_DEFLATED)
    (out/(name+'.template.json')).write_text(json.dumps(template,indent=2)+'\n')
    print(name,hashlib.sha256(bundle.read_bytes()).hexdigest())


if __name__=='__main__':
    output=Path(sys.argv[1]).resolve()
    output.mkdir(parents=True,exist_ok=True)
    write_package(output,'driver-worker','driver-worker-runtime.cjs',build_worker())
    write_package(output,'driver-intake','intake-runtime.cjs',build_intake())
