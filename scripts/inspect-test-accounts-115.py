"""Read-only readiness for the user-selected customer/merchant and driver phones."""
import concurrent.futures
import importlib.util
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance115')


def main():
    OUT.mkdir(mode=0o700, exist_ok=True)
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    session = m.session()
    lam, cog, db = session.client('lambda'), session.client('cognito-idp'), session.resource('dynamodb')
    names = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"], cwd=ROOT))
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        configs = list(pool.map(lambda n: lam.get_function_configuration(FunctionName=n), names))
    by_name = {c['FunctionName']: c for c in configs}
    user_env = by_name['WizzUser-CreateOrder-staging']['Environment']['Variables']
    driver_env = by_name['DriversApi-staging']['Environment']['Variables']
    pools = {'customer': user_env.get('USER_POOL_ID') or user_env.get('COGNITO_USER_POOL_ID'), 'merchant': 'us-east-1_gtCR3ndzT', 'driver': driver_env.get('USER_POOL_ID') or driver_env.get('COGNITO_USER_POOL_ID') or 'us-east-1_RGTqUXF5C'}
    identities = {}
    for role, pool in pools.items():
        phone = '+9647831367435' if role != 'driver' else '+9647800868280'
        users = cog.list_users(UserPoolId=pool, Filter='phone_number = ' + json.dumps(phone), Limit=10)['Users']
        assert len(users) <= 1, 'AMBIGUOUS_PHONE_IDENTITY ' + role
        identities[role] = [{**u, 'attributes': {a['Name']: a['Value'] for a in u['Attributes']}} for u in users]

    def scan(table, expression, values):
        rows, cursor = [], None
        for _ in range(40):
            args = dict(FilterExpression=expression, ExpressionAttributeValues=values, Limit=100, ConsistentRead=True)
            if cursor:
                args['ExclusiveStartKey'] = cursor
            page = db.Table(table).scan(**args)
            rows.extend(page.get('Items', []))
            cursor = page.get('LastEvaluatedKey')
            if not cursor:
                return rows
        raise RuntimeError('LOOKUP_INCOMPLETE')

    customer = scan('WizzUser_users_staging', 'phone IN (:a,:b,:c) OR phoneNumber IN (:a,:b,:c)', {':a': '07831367435', ':b': '+9647831367435', ':c': '9647831367435'})
    drivers = scan('WhizzDrivers_staging', 'phone IN (:a,:b,:c) OR phoneNumber IN (:a,:b,:c)', {':a': '07800868280', ':b': '+9647800868280', ':c': '9647800868280'})
    branches = []
    if identities['merchant']:
        sub = identities['merchant'][0]['attributes']['sub']
        branches = scan('WhizzMerchants_Businesses', 'ownerId=:s OR cognitoUserId=:s', {':s': sub})
    wallet, live = None, None
    if len(drivers) == 1:
        driver = drivers[0]['driverId']
        wallet = db.Table('staging-Wallets').get_item(Key={'walletId': 'WALLET#DRIVER#' + driver, 'sk': 'META'}, ConsistentRead=True).get('Item')
        live = db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId': driver}, ConsistentRead=True).get('Item')
    captured = {'identities': identities, 'customerProfiles': customer, 'driverProfiles': drivers, 'branches': branches, 'wallet': wallet, 'live': live, 'configs': configs}
    p = OUT / 'readiness.private.json'
    p.write_text(json.dumps(captured, default=str, ensure_ascii=False))
    p.chmod(0o600)
    scopes = [json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']) for c in configs]
    result = {'readOnly': True, 'identityReady': {role: bool(rows and rows[0]['Enabled'] and rows[0]['attributes'].get('phone_number_verified') == 'true') for role, rows in identities.items()}, 'customerProfileCount': len(customer), 'driverProfileCount': len(drivers), 'branches': [{k: b.get(k) for k in ['businessId', 'businessName', 'name', 'status']} for b in branches], 'driverWallet': {k: (wallet or {}).get(k) for k in ['availableBalance', 'lockedBalance', 'status']}, 'driverHasOrder': bool((live or {}).get('currentOrderId') or (live or {}).get('activeOrdersCount')), 'coordinatedHosts': len(configs), 'rolloutAgreement': all(s == scopes[0] for s in scopes), 'applicationWrites': False}
    (OUT / 'readiness.json').write_text(json.dumps(result, default=str, ensure_ascii=False, indent=2))
    print(json.dumps(result, default=str, ensure_ascii=False))


if __name__ == '__main__':
    main()
