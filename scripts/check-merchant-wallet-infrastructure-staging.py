#!/usr/bin/env python3
"""Read-only verification of the release75 imports before future wallet deployment."""
import argparse
import json
from pathlib import Path
import boto3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--profile', default='Wizz_stg_UserApp')
args = parser.parse_args()
session = boto3.Session(profile_name=args.profile, region_name='us-east-1')
assert session.client('sts').get_caller_identity()['Account'] == '699561669180'
manifest = json.loads((Path(__file__).resolve().parents[1] / 'docs/merchant-wallet-infrastructure-adoption-75.json').read_text())
cfn = session.client('cloudformation')
rows = []
for page in cfn.get_paginator('list_stack_resources').paginate(StackName=manifest['stack']):
    rows.extend(page['StackResourceSummaries'])
actual = {row['LogicalResourceId']: row for row in rows}
for expected in manifest['resources']:
    row = actual.get(expected['LogicalResourceId'])
    assert row and row['PhysicalResourceId'] == expected['PhysicalResourceId'], expected['LogicalResourceId']
    assert row['ResourceType'] == expected['ResourceType']
    assert row['ResourceStatus'] in ('IMPORT_COMPLETE', 'UPDATE_COMPLETE', 'CREATE_COMPLETE')
reader = session.client('lambda').get_function_configuration(FunctionName='staging-merchant-device-wallet-read')
assert reader['Environment']['Variables']['MERCHANT_STAFF_PERMISSION_MODE'] == 'CENTRAL'
assert reader['Role'].endswith(':role/staging-merchant-device-wallet-read-role')
api = session.client('apigateway')
paths = {row['path']: row for row in api.get_resources(restApiId='z14s5f8oxh', limit=500)['items']}
for path in ('balance', 'transactions', 'statement', 'sales-report'):
    resource = paths['/wallet/branch-device/' + path]
    method = api.get_method(restApiId='z14s5f8oxh', resourceId=resource['id'], httpMethod='GET')
    assert method['authorizationType'] == 'CUSTOM' and method['authorizerId'] == '2bqq12'
    assert 'function:staging-merchant-device-wallet-read/invocations' in method['methodIntegration']['uri']
print(json.dumps({'verifiedImports': len(manifest['resources']), 'mode': 'CENTRAL', 'readRoutes': 4}))
