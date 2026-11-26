"""Build isolated authentication/lifecycle storage from schema metadata only."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SOURCES = {
    'CustomerPhoneAuth': 'WizzUser_phone_auth_staging',
    'CustomerPhoneLink': 'WizzUser_phone_link_staging',
    'DriverOtpSessions': 'WhizzDrivers_otp_sessions_staging',
    'Drivers': 'WhizzDrivers_staging',
    'PlatformStaff': 'staging-PlatformStaff',
    'MerchantPlatform': 'staging-MerchantPlatform',
    'AccountDeletion': 'staging-AccountDeletion',
    'AccountDeletionFinancialArchive': 'staging-AccountDeletionFinancialArchive',
}

def build():
    base = json.loads((ROOT / 'storage-core.template.json').read_text())
    reference = json.loads((ROOT.parent.parent / 'docs/production-schema-reference-2026-11-15.json').read_text())
    schemas = {x['sourceTable']: x for x in reference['tables']}
    template = {k: v for k, v in base.items() if k not in ('Resources', 'Outputs')}
    template.update(Description='Fresh production authentication and lifecycle storage. Empty schemas only.', Resources={}, Outputs={})
    mapping = []
    role = 'MerchantFinancialSessions'
    logical = role + 'Table'
    table_name = 'wizz-production-' + role
    template['Resources'][logical] = {
        'Type': 'AWS::DynamoDB::Table', 'Condition': 'IsProductionAccount',
        'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain',
        'Properties': {
            'TableName': table_name,
            'BillingMode': 'PAY_PER_REQUEST',
            'KeySchema': [{'AttributeName': 'pk', 'KeyType': 'HASH'}, {'AttributeName': 'sk', 'KeyType': 'RANGE'}],
            'AttributeDefinitions': [{'AttributeName': name, 'AttributeType': 'S'} for name in ('pk', 'sk')],
            'SSESpecification': {'SSEEnabled': True},
            'DeletionProtectionEnabled': True,
            'TimeToLiveSpecification': {'AttributeName': 'ttl', 'Enabled': True},
            'Tags': [{'Key': 'Environment', 'Value': 'production'},
                     {'Key': 'DataClass', 'Value': 'ephemeral-financial-verification'}],
        },
    }
    template['Outputs'][role + 'TableName'] = {'Condition': 'IsProductionAccount', 'Value': {'Ref': logical}}
    mapping.append({'role': role, 'schemaReference': None, 'productionTable': table_name, 'dataCopied': False})
    for role, source in SOURCES.items():
        schema = schemas[source]
        props = {
            'TableName': 'wizz-production-' + role,
            'BillingMode': 'PAY_PER_REQUEST',
            'KeySchema': schema['keySchema'],
            'AttributeDefinitions': schema['attributeDefinitions'],
            'SSESpecification': {'SSEEnabled': True},
            'DeletionProtectionEnabled': True,
            'PointInTimeRecoverySpecification': {'PointInTimeRecoveryEnabled': True},
            'Tags': [{'Key': 'Environment', 'Value': 'production'}, {'Key': 'Project', 'Value': 'Wizz'}],
        }
        for field, target in [('globalSecondaryIndexes', 'GlobalSecondaryIndexes'), ('localSecondaryIndexes', 'LocalSecondaryIndexes')]:
            if schema[field]:
                props[target] = schema[field]
        if schema['streamSpecification'].get('StreamEnabled'):
            props['StreamSpecification'] = {'StreamViewType': schema['streamSpecification']['StreamViewType']}
        if schema['ttl']['TimeToLiveStatus'] == 'ENABLED':
            props['TimeToLiveSpecification'] = {'Enabled': True, 'AttributeName': schema['ttl']['AttributeName']}
        logical = role + 'Table'
        template['Resources'][logical] = {
            'Type': 'AWS::DynamoDB::Table', 'Condition': 'IsProductionAccount',
            'DeletionPolicy': 'Retain', 'UpdateReplacePolicy': 'Retain', 'Properties': props,
        }
        template['Outputs'][role + 'TableName'] = {'Value': {'Ref': logical}}
        mapping.append({'role': role, 'schemaReference': source, 'productionTable': props['TableName'], 'dataCopied': False})
    return template, {'accountId': '746727375268', 'recordsCopied': 0, 'tables': mapping}

if __name__ == '__main__':
    template, mapping = build()
    (ROOT / 'storage-auth.template.json').write_text(json.dumps(template, indent=2) + '\n')
    (ROOT / 'storage-auth-map.json').write_text(json.dumps(mapping, indent=2) + '\n')
