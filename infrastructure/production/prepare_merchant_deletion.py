"""Build isolated merchant deletion release packages. Execution defaults to disabled."""
import json
import sys
from pathlib import Path

from prepare_driver_deletion import ROOT, SOURCE, allow, arn, tables, write_package


def merchant_template(kind):
    source = 'intake.template.json' if kind == 'intake' else 'worker-disabled.template.json'
    return json.loads((SOURCE / source).read_text().replace(
        'wizz-production-customer-deletion', 'wizz-production-merchant-deletion'))


def evidence_permissions():
    return [
        allow('dynamodb:GetItem', tables('PlatformStaff'), ['OPERATIONAL_SETTINGS#ACCOUNT_DELETION']),
        allow('dynamodb:GetItem', tables('Wallets'), ['WALLET#MERCHANT#*']),
        allow('dynamodb:GetItem dynamodb:Scan', tables('Merchants')),
        allow('dynamodb:GetItem dynamodb:Query', tables('MerchantPlatform'),
              ['PERSON#*', 'BRANCH#*', 'MERCHANT_PAYOUT#*', 'MERCHANT_CORRECTIONS#*']),
        allow('dynamodb:Scan', tables('Orders Holds WalletLifecycle DispatchJobs TopupRequests IdempotencyKeys')),
    ]


def intake():
    template = merchant_template('intake')
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'merchant-deletion-intake/[a-f0-9]{64}[.]zip'
    template['Parameters']['OtpSecretArn']['AllowedPattern'] = (
        'arn:aws:secretsmanager:us-east-1:746727375268:secret:wizz/production/merchant/otp-[A-Za-z0-9]+')
    variables = template['Resources']['Function']['Properties']['Environment']['Variables']
    variables['ACCOUNT_DELETION_ACTOR_TYPE'] = 'MERCHANT'
    variables['MERCHANT_DELETION_INTAKE_ENABLED'] = variables.pop('CUSTOMER_DELETION_INTAKE_ENABLED')
    variables.pop('DELIVERY_FUNDING_ARCHIVE_ENABLED', None)
    policy = template['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']
    existing = policy['Statement']
    common = [row for row in existing if any(
        value in json.dumps(row['Action']) for value in ['logs:CreateLogStream', 'secretsmanager:GetSecretValue'])]
    policy['Statement'] = common + evidence_permissions() + [
        allow('dynamodb:GetItem dynamodb:PutItem dynamodb:UpdateItem dynamodb:ConditionCheckItem', tables('AccountDeletion'), [
            'SUBJECT#MERCHANT#*', 'VERIFY_ACTIVE#MERCHANT#*', 'DELETE_COOLDOWN#MERCHANT#*',
            'DELETE_DAILY#*#MERCHANT#*', 'DELETE_GLOBAL#*', 'CHALLENGE#*', 'RECEIPT#*']),
        allow('dynamodb:UpdateItem', tables('Merchants')),
    ]
    return template


def worker():
    template = merchant_template('worker')
    params = template['Parameters']
    params['ArtifactKey']['AllowedPattern'] = 'merchant-deletion/[a-f0-9]{64}[.]zip'
    params.pop('SupportSocketId')
    params['CatalogOrigin'] = {'Type': 'String', 'AllowedPattern': r'https://[a-z0-9]{10}[.]execute-api[.]us-east-1[.]amazonaws[.]com'}
    for name in ('MutationGuardsVerified', 'EnrollmentGuardsVerified'):
        params[name] = {'Type': 'String', 'Default': 'false', 'AllowedValues': ['false', 'true']}
        template['Conditions']['ExecutionOn']['Fn::And'].append({'Fn::Equals': [{'Ref': name}, 'true']})
    resources = template['Resources']
    properties = resources['Worker']['Properties']
    properties['Timeout'] = 300
    variables = {key: value for key, value in json.loads(
        (ROOT / 'order-financial-runtime.template.json').read_text())['Resources']['Function']['Properties']['Environment']['Variables'].items()
        if isinstance(value, str)}
    variables.update(ENVIRONMENT='production', STAGE='production',
                     MERCHANT_DELETION_ENABLED={'Fn::If': ['ExecutionOn', 'true', 'false']},
                     MERCHANT_DELETION_MUTATION_GUARDS_VERIFIED={'Ref': 'MutationGuardsVerified'},
                     MERCHANT_DELETION_ENROLLMENT_GUARDS_VERIFIED={'Ref': 'EnrollmentGuardsVerified'},
                     MERCHANT_CATALOG_ORIGIN={'Ref': 'CatalogOrigin'})
    properties['Environment']['Variables'] = variables
    resources['RetrySchedule']['Properties']['Targets'][0].update(
        Id='MerchantDeletionWorker', Input='{"operation":"MERCHANT_DELETION_SWEEP"}')
    account_keys = ['SUBJECT#MERCHANT#*', 'BUSINESS_LIFECYCLE#MERCHANT#*', 'ACCOUNT_LIFECYCLE#MERCHANT#*',
                    'MERCHANT_PHONE_CLOSURE#*', 'SCHEDULER#MERCHANT']
    catalog = 'wizz-production-merchant-catalog-api-746727375268'
    onboarding = 'wizz-production-merchant-onboarding-746727375268'
    resources['WorkerRole']['Properties']['Policies'][1]['PolicyDocument']['Statement'] = evidence_permissions() + [
        allow('dynamodb:Scan', tables('AccountDeletion Products GlobalProducts MerchantDiscounts WorkingHours BusinessSubcategories '
            'MenuCategories MerchantFinancialSessions MerchantOtpSessions')),
        allow('dynamodb:GetItem dynamodb:Query', tables('AccountDeletion'), account_keys + ['ACCOUNT_OPERATION#MERCHANT#*']),
        allow('dynamodb:PutItem dynamodb:UpdateItem dynamodb:ConditionCheckItem', tables('AccountDeletion'), account_keys),
        allow('dynamodb:DeleteItem', tables('AccountDeletion'), ['MERCHANT_PHONE_CLOSURE#*']),
        allow('dynamodb:PutItem dynamodb:ConditionCheckItem', tables('Wallets'), ['WALLET#MERCHANT#*']),
        allow('dynamodb:UpdateItem', tables('Wallets'), ['WALLET#MERCHANT#*']),
        allow('dynamodb:PutItem dynamodb:UpdateItem dynamodb:ConditionCheckItem', tables('Merchants')),
        allow('dynamodb:GetItem dynamodb:ConditionCheckItem', tables('Orders Holds WaveOffers')),
        allow('dynamodb:UpdateItem', tables('Orders')),
        allow('dynamodb:GetItem dynamodb:Query', tables('MerchantPlatform'),
              ['PERSON#*', 'BRANCH#*', 'REVIEW#MERCHANT', 'STAFF_PHONE#*', 'MERCHANT_POS#*', 'MERCHANT_PAYOUT_PAID#*', 'FULL_CASH_JOURNAL#*']),
        allow('dynamodb:DeleteItem', tables('MerchantPlatform'), ['PERSON#*', 'BRANCH#*', 'REVIEW#MERCHANT', 'STAFF_PHONE#*', 'MERCHANT_POS#*']),
        allow('dynamodb:DeleteItem', tables('Products WorkingHours BusinessSubcategories MenuCategories MerchantFinancialSessions MerchantOtpSessions')),
        allow('dynamodb:DeleteItem', tables('IdempotencyKeys'), ['MERCHANT_FINANCE#*']),
        allow('cognito-idp:AdminGetUser cognito-idp:AdminDisableUser cognito-idp:AdminUserGlobalSignOut cognito-idp:AdminDeleteUser',
              arn('cognito-idp', 'userpool/us-east-1_2sKZ4fGbZ')),
        {'Effect': 'Allow', 'Action': 's3:ListBucketVersions', 'Resource': ['arn:aws:s3:::' + catalog, 'arn:aws:s3:::' + onboarding],
         'Condition': {'StringLike': {'s3:prefix': ['merchants/*/product-images/*', 'persons/*']}}},
        allow('s3:DeleteObjectVersion', ['arn:aws:s3:::' + catalog + '/merchants/*/product-images/*',
                                         'arn:aws:s3:::' + onboarding + '/persons/*']),
    ]
    return template


if __name__ == '__main__':
    output = Path(sys.argv[1]).resolve()
    output.mkdir(parents=True, exist_ok=True)
    for name, entry, template in [
        ('merchant-worker', 'merchant-worker-runtime.cjs', worker()),
        ('merchant-intake', 'intake-runtime.cjs', intake()),
    ]:
        write_package(output, name, entry, template)
