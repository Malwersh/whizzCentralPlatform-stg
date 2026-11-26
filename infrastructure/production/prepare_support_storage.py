"""Create the isolated production storage for the active staging support protocol."""
import json
from pathlib import Path
import sys

from prepare_merchant_profile import build as profile
from prepare_customer_storefront import ref, sub

ACCOUNT='746727375268'
BUCKET='wizz-production-support-attachments-'+ACCOUNT+'-us-east-1'
NAMES={
    'chat-sessions-staging':'SupportChatSessions',
    'chat-messages-staging':'SupportChatMessages',
    'support-message-receipts-staging':'SupportMessageReceipts',
    'support-attachments-staging':'SupportAttachments',
    'websocket-connections-staging':'SupportConnections',
    'websocket-subscriptions-staging':'SupportSubscriptions',
}
TAG=[{'Key':'Environment','Value':'production'},{'Key':'Project','Value':'Wizz'}]


def build(schemas):
    assert {s['TableName'] for s in schemas}==set(NAMES) and all(s['TableStatus']=='ACTIVE' for s in schemas)
    template=profile()
    resources=template['Resources']={}
    template['Description']='Private support conversation storage, isolated in Wizz production.'
    template['Parameters']={'ExpectedAccountId':template['Parameters']['ExpectedAccountId']}
    template['Outputs']={}

    def add(name,kind,properties,retain=False):
        resources[name]={'Type':kind,'Condition':'IsProductionAccount','Properties':properties,
                         **({'DeletionPolicy':'Retain','UpdateReplacePolicy':'Retain'} if retain else {})}

    for schema in schemas:
        name=NAMES[schema['TableName']]
        props={
            'TableName':'wizz-production-'+name,'BillingMode':'PAY_PER_REQUEST',
            'KeySchema':schema['KeySchema'],'AttributeDefinitions':schema['AttributeDefinitions'],
            'DeletionProtectionEnabled':True,'SSESpecification':{'SSEEnabled':True},
            'PointInTimeRecoverySpecification':{'PointInTimeRecoveryEnabled':True},'Tags':TAG,
        }
        if schema['ttl']['TimeToLiveStatus']=='ENABLED':
            props['TimeToLiveSpecification']={'Enabled':True,'AttributeName':schema['ttl']['AttributeName']}
        if schema.get('GlobalSecondaryIndexes'):
            props['GlobalSecondaryIndexes']=[{key:index[key] for key in ('IndexName','KeySchema','Projection')}
                                            for index in schema['GlobalSecondaryIndexes']]
        add(name,'AWS::DynamoDB::Table',props,True)
        template['Outputs'][name]={'Condition':'IsProductionAccount','Value':ref(name)}

    add('PrivateImages','AWS::S3::Bucket',{
        'BucketName':BUCKET,'Tags':TAG,
        'BucketEncryption':{'ServerSideEncryptionConfiguration':[{'ServerSideEncryptionByDefault':{'SSEAlgorithm':'AES256'}}]},
        'OwnershipControls':{'Rules':[{'ObjectOwnership':'BucketOwnerEnforced'}]},
        'PublicAccessBlockConfiguration':{'BlockPublicAcls':True,'IgnorePublicAcls':True,
                                          'BlockPublicPolicy':True,'RestrictPublicBuckets':True},
        'LifecycleConfiguration':{'Rules':[
            {'Id':'ExpireSupportImages','Status':'Enabled','Prefix':'support-images/','ExpirationInDays':30},
            {'Id':'AbortIncompleteUploads','Status':'Enabled',
             'AbortIncompleteMultipartUpload':{'DaysAfterInitiation':1}},
        ]},
    },True)
    add('PrivateImagesTLS','AWS::S3::BucketPolicy',{'Bucket':ref('PrivateImages'),
        'PolicyDocument':{'Version':'2012-10-17','Statement':[{
            'Sid':'RequireTLS','Effect':'Deny','Principal':'*','Action':'s3:*',
            'Resource':[sub('arn:${AWS::Partition}:s3:::${PrivateImages}'),
                        sub('arn:${AWS::Partition}:s3:::${PrivateImages}/*')],
            'Condition':{'Bool':{'aws:SecureTransport':'false'}},
        }]}
    })
    template['Outputs']['PrivateImages']={'Condition':'IsProductionAccount','Value':ref('PrivateImages')}
    return template


if __name__=='__main__':
    schema=Path(sys.argv[1])
    output=Path(sys.argv[2])
    output.parent.mkdir(exist_ok=True,parents=True)
    output.write_text(json.dumps(build(json.loads(schema.read_text())),indent=2)+'\n')
