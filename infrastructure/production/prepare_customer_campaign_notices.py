"""Package the production campaign notification worker and the customer eligibility contract."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import CUSTOMER, REPO, allow, table
from prepare_customer_home import leading
from prepare_merchant_payout_notices import NAME as PAYOUT, build as payout_template
from prepare_order_financial_runtime import dynamodb

NAME = 'wizz-production-customer-campaign-notices'
PREFIX = 'CAMPAIGN_PUSH#'


def projection(fields, scan=False):
    return {
        'ForAllValues:StringEquals': {'dynamodb:Attributes': fields.split(',')},
        'Null': {'dynamodb:Attributes': 'false'},
        **({'StringEquals': {'dynamodb:Select': 'SPECIFIC_ATTRIBUTES'}} if scan else {}),
    }


def build():
    template = json.loads(json.dumps(payout_template()).replace(PAYOUT, NAME))
    template['Description'] = 'Eligible opted-in production customer campaign announcements and inbox delivery.'
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'customer-campaign-notices/[a-f0-9]{64}[.]zip'
    r = template['Resources']
    policy = r['Role']['Properties']['Policies'][0]
    policy['PolicyName'] = 'CustomerCampaignNotices'
    inherited = [item for item in policy['PolicyDocument']['Statement'] if any(
        value in json.dumps(item) for value in ('logs:CreateLogStream','OutboxStreamArn','FirebaseProductionSecretArn','sqs:SendMessage')
    )]
    write = dynamodb('WalletNotifications','UpdateItem',(PREFIX+'*','CAMPAIGN_PUSH_TOKEN#*'))
    del write['Condition']['StringEquals']
    inbox = dynamodb('WalletNotifications','PutItem',('CN:*',))
    del inbox['Condition']['StringEquals']
    inbox['Condition']['ForAllValues:StringEquals'] = {
        'dynamodb:Attributes': 'eventId,driverId,recipientApp,type,title,body,createdAt,deliveryStatus,nextAttemptAt,attempts,ttl,campaignId'.split(',')
    }
    inbox['Condition']['Null']['dynamodb:Attributes'] = 'false'
    inherited.extend([
        allow('dynamodb:Query', table('WalletNotifications/index/PendingDelivery'), leading(['CAMPAIGN_PENDING'])),
        dynamodb('WalletNotifications', 'GetItem', ('CAMPAIGN_PUSH_TOKEN#*',)),
        dynamodb('WalletNotifications', 'PutItem', ('CAMPAIGN_PUSH_TOKEN#*',)),
        write, inbox,
        allow('dynamodb:Scan', table('PushDeviceTokens'), projection('token,subjectId,app,env,ttl,isDeleted,disabled', True)),
        dynamodb('PushDeviceTokens','GetItem'),
        dynamodb('PlatformDiscounts','GetItem'),
        dynamodb('Customers','ConditionCheckItem'),
        allow('dynamodb:GetItem', table('Customers'),
              projection('userId,cognitoSub,isActive,isDeleted,deletedAt,deletionRequestId,notification_settings,marketing_consent,createdAt,isVip')),
        dynamodb('AccountDeletion','GetItem',('ACCOUNT_LIFECYCLE#CUSTOMER#*',)),
        dynamodb('AccountDeletion','ConditionCheckItem',('ACCOUNT_LIFECYCLE#CUSTOMER#*',)),
        dynamodb('OfferJourney','GetItem',('USER#*',)),
        allow('dynamodb:Scan',table('Orders'),
              projection('PK,SK,userSub,userId,orderId,createdAt,discountId,promoCode,offerSnapshot,offerUsageRelease',True)),
        allow('dynamodb:Query',table('Addresses/index/userId-isDefault-index')),
        allow('dynamodb:GetItem',table('Addresses'),projection('addressId,userId,isDefault,deletedAt,isDeleted,regionId')),
        dynamodb('Regions','GetItem'),
        dynamodb('Merchants','GetItem'),
    ])
    policy['PolicyDocument']['Statement'] = inherited
    env = r['Worker']['Properties']['Environment']['Variables']
    env.update(CAMPAIGN_NOTICE_STREAM_ARN=env.pop('PAYOUT_NOTICE_STREAM_ARN'), ENVIRONMENT='production')
    r['RetryTick']['Properties']['Targets'][0]['Id'] = 'CustomerCampaigns'
    r['OutboxSource']['Properties']['FilterCriteria']['Filters'][0]['Pattern'] = json.dumps({
        'eventName':['INSERT'],'dynamodb': {
            'Keys': {'eventId': {'S': [{'prefix': PREFIX}]}},
            'NewImage': {'type': {'S': ['campaign_push_job']}, 'deliveryStatus': {'S': ['CAMPAIGN_PENDING']}},
        },
    })
    return template


def package(out):
    out.mkdir(parents=True,exist_ok=True)
    modules=REPO/'backend/wallet-service/node_modules'
    tool=str(modules/'.bin/esbuild')
    flags=['--bundle','--platform=node','--target=node22','--format=cjs','--log-level=error','--external:@aws-sdk/*']
    env={**os.environ,'NODE_PATH':str(modules)}
    artifact=out/'customer-campaign-notices.zip'
    with ZipFile(artifact,'w') as archive:
        for filename,source,cwd,extra in [
            ('index.js','infrastructure/production/customer-campaign-notices.cjs',REPO,['--external:./offer-eligibility.cjs']),
            ('offer-eligibility.cjs','src/functions/shared/offer-eligibility.js',CUSTOMER,[]),
        ]:
            code=subprocess.check_output([tool,source,*flags,*extra],cwd=cwd,env=env)
            archive.writestr(ZipInfo(filename,(2026,1,1,0,0,0)),code,compress_type=ZIP_DEFLATED)
    (out/'customer-campaign-notices.template.json').write_text(json.dumps(build(),separators=(',',':'))+'\n')
    print(hashlib.sha256(artifact.read_bytes()).hexdigest())


if __name__ == '__main__':
    package(Path(sys.argv[1]))
