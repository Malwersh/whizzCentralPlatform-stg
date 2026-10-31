import json
import os
import boto3
with open(os.path.join(os.path.dirname(__file__), 'staff-roles.json')) as source:
    STAFF_ROLES = json.load(source)

def required_permissions(method, path):
    if '/wallet/funding/admin/zaincash' in path and method != 'GET': return ['finance.settings.request']
    if path.endswith('/lifecycle/retry'): return ['finance.approve']
    if method == 'GET' or path.endswith('/receipt'): return ['finance.read']
    if path.endswith('/transfer-settings/approve'): return ['finance.settings.approve']
    if path.endswith('/transfer-settings/cancel'): return ['finance.settings.request', 'finance.settings.approve']
    if path.endswith('/transfer-settings'): return ['finance.settings.request']
    if path.endswith('/transfer/approve'): return ['finance.approve']
    if path.endswith('/transfer'): return ['finance.request']
    if '/topup/' in path: return ['finance.approve'] if path.endswith('/approve') else ['finance.topup.review']
    return ['bootstrap.only']

def access(payload, method, path, pool):
    table = os.environ.get('STAFF_TABLE')
    if not table or payload.get('token_use') != 'access' or payload.get('client_id') != os.environ.get('ADMIN_CLIENT_ID'): raise Exception('Forbidden')
    employee = boto3.resource('dynamodb').Table(table).get_item(Key={'pk':'EMPLOYEE#'+payload['sub'],'sk':'PROFILE'},ConsistentRead=True).get('Item',{})
    if employee.get('status') != 'ACTIVE' or not employee.get('scope',{}).get('allRegions'): raise Exception('Forbidden')
    live = boto3.client('cognito-idp').admin_get_user(UserPoolId=pool,Username=payload['username'])
    if not live.get('Enabled') or (employee.get('mfaRequired') and 'SOFTWARE_TOKEN_MFA' not in live.get('UserMFASettingList',[])): raise Exception('Forbidden')
    if payload.get('auth_time',0) < employee.get('minimumAuthTime',0): raise Exception('Forbidden')
    permissions = set(permission for role in employee.get('roles',[]) for permission in STAFF_ROLES.get(role,[]))
    direct = os.environ.get('PLATFORM_ENVIRONMENT') == 'staging' and os.environ.get('PLATFORM_WRITE_MODE') == 'DIRECT'
    operator = direct and payload['sub'] in os.environ.get('PLATFORM_DIRECT_OPERATOR_IDS','').split(',')
    if operator: permissions.update(p for values in STAFF_ROLES.values() for p in values)
    if 'bootstrap_admin' in employee.get('roles',[]) or operator: permissions.add('bootstrap.only')
    if not any(permission in permissions for permission in required_permissions(method,path)): raise Exception('Forbidden')
    return employee, permissions
