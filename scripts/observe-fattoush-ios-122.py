"""Read only the new merchant-discount canary; never simulates user actions."""
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance122')


def main():
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    db = capture.session().resource('dynamodb')
    selector = json.loads((OUT / 'selector.private.json').read_text())
    scope = json.loads((OUT / 'scope.private.json').read_text())['scopes'][-1]
    oid = selector['orderId']
    order = db.Table('WizzOrders').get_item(Key={'PK': 'ORDER#' + oid, 'SK': 'META'}, ConsistentRead=True).get('Item')
    result = {'readOnly': True, 'orderExists': bool(order)}
    if order:
        assert order.get('userSub') == scope['orders'][0]['customerSubjectId']
        assert (order.get('storeId') or order.get('businessId')) == selector['branchId']
        p = OUT / 'canary-order.private.json'
        p.write_text(json.dumps(order, default=str, ensure_ascii=False, indent=2))
        p.chmod(0o600)
        result.update({k: order.get(k) for k in ['status', 'paymentStatus', 'dispatchStatus']})
        snapshot = order.get('financialSnapshot', {}).get('snapshot', {})
        result['allocation'] = snapshot.get('allocation')
        result['confirmedCustomerTotal'] = snapshot.get('confirmedCustomerTotal')
        result['accepted'] = bool(order.get('financialAcceptance'))
        result['commercialFundingState'] = order.get('commercialPricing', {}).get('funding', {}).get('state')
    p = OUT / 'observation.json'
    p.write_text(json.dumps(result, default=str, indent=2))
    print(json.dumps(result, default=str))


if __name__ == '__main__':
    main()
