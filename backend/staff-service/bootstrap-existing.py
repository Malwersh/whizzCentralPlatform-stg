"""Seed only the two verified legacy Staging accounts; never overwrite profiles."""
import datetime, json, subprocess, uuid
PROFILE = 'Wizz_stg_UserApp'
POOL = 'us-east-1_wz7vwZZxz'
TABLE = 'staging-PlatformStaff'
def aws(*args):
    output = subprocess.check_output(['aws', *args, '--profile', PROFILE, '--region', 'us-east-1', '--output', 'json'])
    return json.loads(output) if output.strip() else {}
def typed(value):
    if isinstance(value, bool): return {'BOOL': value}
    if isinstance(value, int): return {'N': str(value)}
    if isinstance(value, str): return {'S': value}
    if isinstance(value, list): return {'L': [typed(v) for v in value]}
    if isinstance(value, dict): return {'M': {k: typed(v) for k, v in value.items()}}
    raise ValueError('Unsupported value')
identity = aws('sts', 'get-caller-identity')
if identity['Account'] != '699561669180': raise SystemExit('Staging account required')
users = aws('cognito-idp', 'list-users', '--user-pool-id', POOL)['Users']
expected = {
    'f40834f8-4091-7054-0e20-dba35a2793ce': ('bootstrap_admin', {'admins', 'finance_manager'}),
    'b4580498-1051-7082-b378-32de559766d6': ('customer_service', {'support'}),
}
operations = []
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
for user in users:
    attrs = {a['Name']: a['Value'] for a in user['Attributes']}
    sub = attrs['sub']
    if sub not in expected: continue
    role, required = expected[sub]
    groups = {g['GroupName'] for g in aws('cognito-idp', 'admin-list-groups-for-user', '--user-pool-id', POOL, '--username', user['Username'])['Groups']}
    if groups != required or not user['Enabled']: raise SystemExit('Legacy user state changed; review required')
    item = {'pk': 'EMPLOYEE#' + sub, 'sk': 'PROFILE', 'employeeId': sub, 'username': user['Username'], 'name': attrs.get('name', attrs.get('email', sub)), 'email': attrs.get('email', ''), 'roles': [role], 'scope': {'allRegions': True, 'regionIds': []}, 'status': 'ACTIVE', 'approvalLimit': 0, 'version': 1, 'createdAt': now, 'updatedAt': now}
    operations.append({'Put': {'TableName': TABLE, 'Item': typed(item)['M'], 'ConditionExpression': 'attribute_not_exists(pk)'}})
if len(operations) != 2: raise SystemExit('Expected two legacy accounts')
audit = {'pk': 'AUDIT', 'sk': now + '#' + str(uuid.uuid4()), 'action': 'LEGACY_STAFF_BOOTSTRAPPED', 'actorId': identity['Arn'], 'createdAt': now, 'employeeIds': list(expected), 'reason': 'Preserve legacy administrator and support access during Staging migration'}
operations.append({'Put': {'TableName': TABLE, 'Item': typed(audit)['M'], 'ConditionExpression': 'attribute_not_exists(sk)'}})
aws('dynamodb', 'transact-write-items', '--transact-items', json.dumps(operations, ensure_ascii=False))
print('Seeded two legacy profiles with one atomic audit event; existing Cognito groups unchanged.')
