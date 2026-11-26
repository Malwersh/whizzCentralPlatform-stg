"""Extend existing production finance and monitoring stacks for staff unassignment."""
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from prepare_customer_storefront import REPO, allow, ref, sub
from prepare_order_financial_runtime import dynamodb
from prepare_order_returns import add_resource, method, resource

FINANCE = 'wizz-production-order-financial'
MONITOR = 'wizz-production-order-monitoring'
FINANCE_ARN = sub('arn:${AWS::Partition}:lambda:${AWS::Region}:${AWS::AccountId}:function:' + FINANCE)


def finance_template(base):
    template = copy.deepcopy(base)
    resources = template['Resources']
    env = resources['Function']['Properties']['Environment']['Variables']
    assert env['FINANCIAL_ORDER_HOST_MODE'] == ref('HostMode')
    assert env['DELIVERY_OPERATIONS_MODE'] == 'CENTRAL'
    env['FINANCIAL_COD_ACCOUNT_ID'] = ref('AWS::AccountId')
    template['Parameters']['ArtifactKey']['AllowedPattern'] = 'order-financial/[a-f0-9]{64}[.]zip'
    role = resources['Role']['Properties']
    role['Policies'].append({'PolicyName':'StaffUnassignmentAuthority','PolicyDocument':{
        'Version':'2012-10-17','Statement':[
            dynamodb('PlatformStaff','GetItem',('EMPLOYEE#*',)),
            dynamodb('PlatformStaff','ConditionCheckItem',('EMPLOYEE#*',)),
            allow('cognito-idp:AdminGetUser', sub(
                'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/' + env['ADMIN_USER_POOL_ID'])),
        ],
    }})
    return template


def monitor_template(base):
    template = copy.deepcopy(base)
    resources = template['Resources']
    policies = resources['Role']['Properties']['Policies']
    policies.append({'PolicyName':'InvokeStaffUnassignment','PolicyDocument':{
        'Version':'2012-10-17','Statement':[allow('lambda:InvokeFunction',FINANCE_ARN)],
    }})
    resource(template,'Assignment','StaffApi',ref('MonitorRoot'),'assignment')
    dependencies = []
    for verb in ('GET','POST'):
        dependencies += method(template,'Assignment'+verb,'StaffApi','Assignment',verb,
            'staff/order-monitoring/assignment',function_name=MONITOR,dependency='MonitorFunction')
    stage = resources['Stage']['Properties']
    existing=stage['DeploymentId']['Ref']
    add_resource(template,'AssignmentDeployment','AWS::ApiGateway::Deployment',{'RestApiId':ref('StaffApi')},
                 DependsOn=resources[existing]['DependsOn']+dependencies)
    stage['DeploymentId']=ref('AssignmentDeployment')
    return template


def bundled(entry):
    modules = REPO/'backend/wallet-service/node_modules'
    return subprocess.check_output([
        str(modules/'.bin/esbuild'), entry, '--bundle','--platform=node','--target=node22','--format=cjs',
        '--keep-names','--external:@aws-sdk/*',
    ],cwd=REPO)


def package(files, artifact):
    with ZipFile(artifact,'w') as archive:
        for name, data in files.items():
            archive.writestr(ZipInfo(name,(2026,1,1,0,0,0)),data,compress_type=ZIP_DEFLATED)
    return hashlib.sha256(artifact.read_bytes()).hexdigest()


def package_finance(previous, output):
    with ZipFile(previous) as archive:
        assert archive.namelist() == ['index.js']
        deployed = archive.read('index.js')
    wrapper = b"""'use strict';
const live = require('./previous-runtime.cjs');
module.exports = {
  ...live,
  financialAcceptanceHandler(event, ...args) {
    if (event?.action === 'staff_order_management') {
      return require('./staff-order-management.cjs').handler(event);
    }
    return live.financialAcceptanceHandler(event, ...args);
  },
};
"""
    return package({
        'index.js':wrapper,
        'previous-runtime.cjs':deployed,
        'staff-order-management.cjs':bundled('backend/wallet-service/src/staffOrderManagement.ts'),
    },output)


if __name__=='__main__':
    output=Path(sys.argv[1]).resolve()
    output.mkdir(parents=True,exist_ok=True)
    print('finance',package_finance(output/'previous-runtime.zip',output/'order-financial.zip'))
    print('monitor',package({'index.js':bundled('infrastructure/production/order-monitoring/index.cjs')},
                            output/'order-monitoring.zip'))
