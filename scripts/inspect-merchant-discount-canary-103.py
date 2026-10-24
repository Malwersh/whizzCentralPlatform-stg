"""Read-only preparation for the merchant-funded discount canary; no mutations."""
import datetime
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance103')


def main():
    OUT.mkdir(mode=0o700, exist_ok=True)
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    db = capture.session().resource('dynamodb')
    selector = json.loads(pathlib.Path('/private/tmp/finance94/selector.private.json').read_text())
    identities = json.loads(pathlib.Path('/private/tmp/finance85/selected-identities.private.json').read_text())
    branch = selector['branchId']
    driver = identities['profiles']['driver'][0]['driverId']
    rows = []
    cursor = None
    while True:
        args = dict(FilterExpression='businessId = :b', ExpressionAttributeValues={':b': branch}, ConsistentRead=True)
        if cursor:
            args['ExclusiveStartKey'] = cursor
        page = db.Table('WhizzMerchants_Discounts').scan(**args)
        rows.extend(page.get('Items', []))
        cursor = page.get('LastEvaluatedKey')
        if not cursor:
            break
    funding = {}
    for row in rows:
        binding = db.Table('staging-MerchantPlatform').get_item(
            Key={'pk': 'BRANCH#' + branch, 'sk': 'COMMERCIAL_SHARING#MERCHANT#' + row['discountId']},
            ConsistentRead=True).get('Item')
        if binding:
            funding[row['discountId']] = db.Table('staging-PlatformStaff').get_item(
                Key={'pk': 'DISCOUNT_FUNDING#' + binding['policyId'], 'sk': 'CURRENT'}, ConsistentRead=True
            ).get('Item')
    wallet = db.Table('staging-Wallets').get_item(Key={'walletId': 'WALLET#DRIVER#' + driver, 'sk': 'META'}, ConsistentRead=True)['Item']
    live = db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId': driver}, ConsistentRead=True).get('Item', {})
    result = {'checkedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'readOnly': True,
              'discounts': rows, 'fundingPolicies': funding, 'driverWallet': wallet, 'driverLive': live}
    path = OUT / 'preflight.private.json'
    path.write_text(json.dumps(result, default=str, ensure_ascii=False, indent=2))
    path.chmod(0o600)
    fields = ['discountId', 'title', 'name', 'version', 'isActive', 'status', 'discountType', 'discountValue',
              'value', 'validFrom', 'validTo', 'startDate', 'endDate', 'minOrderAmount', 'fundingPolicyId', 'isDeleted']
    print(json.dumps({'readOnly': True, 'discounts': [{k: r[k] for k in fields if k in r} for r in rows],
                      'driverAvailable': wallet['availableBalance'], 'driverLocked': wallet['lockedBalance'],
                      'sharingBindingCount': len(funding),
                      'driverHasOrder': bool(live.get('currentOrderId') or live.get('activeOrdersCount', 0))}, default=str, ensure_ascii=False))


if __name__ == '__main__':
    main()
