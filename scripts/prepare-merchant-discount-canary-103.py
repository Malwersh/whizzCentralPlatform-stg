"""Prepare/publish one exact staging checkout, retaining financial history and auditing any retired pin.

Default is read-only. --execute changes only rollout configuration on the current
15-host inventory; never creates an order or changes money, pricing or consent.
"""
import copy
import datetime
import importlib.util
import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance103')


def main():
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    session = capture.session()
    db, lam = session.resource('dynamodb'), session.client('lambda')
    preflight = json.loads((OUT / 'preflight.private.json').read_text())
    assert not preflight['fundingPolicies'], 'SHARED_DISCOUNT_REQUIRES_SEPARATE_TEST'
    assert len(preflight['discounts']) == 1
    discount = preflight['discounts'][0]
    assert discount['status'] == 'active' and discount['type'] == 'percentage' and float(discount['value']) == 10
    old_selector = json.loads(pathlib.Path('/private/tmp/finance94/selector.private.json').read_text())
    defines = json.loads(pathlib.Path('/private/tmp/finance94/user-dart-defines.private.json').read_text())
    previous_attempt = json.loads(defines['FINANCE_TEST_CHECKOUT_ATTEMPT'])
    old_selector['userId'] = previous_attempt['userId']
    selector_path = OUT / 'selector.private.json'
    if not selector_path.exists() or 'userId' not in json.loads(selector_path.read_text()):
        node = "const x=JSON.parse(require('fs').readFileSync(0,'utf8')),r=require('crypto').randomUUID();x.requestId=r;x.orderId=require('./backend/wallet-service/dist/deliveryQuoteOrder').orderIdFor(x.userId,r);console.log(JSON.stringify(x))"
        selector_path.write_bytes(subprocess.check_output(['node', '-e', node], input=json.dumps(old_selector).encode(), cwd=ROOT))
        selector_path.chmod(0o600)
    selector = json.loads(selector_path.read_text())
    assert selector['branchId'] == discount['businessId']
    assert not db.Table('WizzOrders').get_item(Key={'PK': 'ORDER#' + selector['orderId'], 'SK': 'META'}, ConsistentRead=True).get('Item')
    names = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"], cwd=ROOT))
    assert len(names) == 15
    rows = [lam.get_function_configuration(FunctionName=n) for n in names]
    old = json.loads(rows[0]['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG'])
    assert all(json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']) == old for c in rows), 'SCOPE_DRIFT'
    assert len(old['scopes']) == 3, 'PRIOR_SCOPE_AUDIT_REQUIRED'
    source = old['scopes'][-1]
    prior = db.Table('WizzOrders').get_item(Key={'PK': 'ORDER#' + source['orders'][0]['orderId'], 'SK': 'META'}, ConsistentRead=True)['Item']
    assert prior['status'] == 'delivered', 'PRIOR_CANARY_NOT_TERMINAL'
    driver = source['drivers'][0]['driverId']
    wallet = db.Table('staging-Wallets').get_item(Key={'walletId': 'WALLET#DRIVER#' + driver, 'sk': 'META'}, ConsistentRead=True)['Item']
    live = db.Table('WizzDriverLiveState_staging').get_item(Key={'driverId': driver}, ConsistentRead=True)['Item']
    assert wallet['lockedBalance'] == 0 and wallet['availableBalance'] >= 25000
    assert not live.get('currentOrderId') and not live.get('activeOrdersCount', 0)
    # Separate terminal audit before retiring the cancelled, unfunded superseded pin.
    # Their database history is retained; the delivered financial pin stays DRAIN.
    retired = []
    for scope in old['scopes'][1:2]:
        assert scope['mode'] == 'DRAIN' or scope['admitUntil'] < datetime.datetime.now(datetime.timezone.utc).isoformat()
        for old_order in scope['orders']:
            oid = old_order['orderId']
            order = db.Table('WizzOrders').get_item(Key={'PK': 'ORDER#' + oid, 'SK': 'META'}, ConsistentRead=True).get('Item')
            assert order is None or order['status'] == 'cancelled'
            if order:
                assert order.get('maintenanceCancellation', {}).get('noAssignmentOrFunds') is True
                assert not order.get('financialAcceptance') and not order.get('financialOutcome')
            captured = {}
            for table in ['staging-Holds', 'WaveOffers_staging', 'WizzDispatchJobs_staging']:
                page = db.Table(table).query(KeyConditionExpression='orderId=:o', ExpressionAttributeValues={':o': oid}, ConsistentRead=True)
                assert not page.get('LastEvaluatedKey')
                captured[table] = page['Items']
            assert not captured['staging-Holds'], 'RETIRED_PIN_HAS_FINANCIAL_OBLIGATION'
            assert all(r.get('responseStatus') in ['financial_expired', 'financial_rejected'] for r in captured['WaveOffers_staging'])
            assert all(r.get('status') in ['cancelled', 'no_driver_available'] if r['SK'] == 'METADATA' else r.get('state') == 'EXPIRED' for r in captured['WizzDispatchJobs_staging'])
            cursor = None
            while True:
                args = dict(FilterExpression='relatedEntityId=:o OR #m.orderId=:o', ExpressionAttributeNames={'#m': 'metadata'}, ExpressionAttributeValues={':o': oid}, ConsistentRead=True)
                if cursor:
                    args['ExclusiveStartKey'] = cursor
                page = db.Table('staging-LedgerEntries').scan(**args)
                assert not page['Items'], 'RETIRED_PIN_HAS_LEDGER_HISTORY_REQUIRING_REVIEW'
                cursor = page.get('LastEvaluatedKey')
                if not cursor:
                    break
            retired.append({'scope': scope, 'orderAbsent': order is None, 'captured': captured, 'noHoldsOrLedger': True})
    p = OUT / 'terminal-retirement-audit.private.json'
    p.write_text(json.dumps(retired, default=str, indent=2))
    p.chmod(0o600)
    candidate = copy.deepcopy(old)
    candidate['scopes'] = [candidate['scopes'][0], candidate['scopes'][2]]
    for scope in candidate['scopes']:
        scope['mode'] = 'DRAIN'
    new = copy.deepcopy(source)
    new.update(id='fattoush-merchant-discount-103', mode='SCOPED', admitUntil=(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(minutes=45)).isoformat(timespec='milliseconds').replace('+00:00', 'Z'))
    new['orders'] = [{**source['orders'][0], 'orderId': selector['orderId']}]
    candidate['scopes'].append(new)
    raw = json.dumps(candidate, separators=(',', ':'))
    digest = subprocess.check_output(['node', '-e', "const x=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(x))"], input=raw.encode(), cwd=ROOT).decode().strip()
    manifest = {'account': '699561669180', 'region': 'us-east-1', 'functions': []}
    for c in rows:
        env = {**c['Environment']['Variables'], 'FINANCE_ROLLOUT_CONFIG': raw, 'FINANCE_ROLLOUT_SHA256': digest}
        assert len(json.dumps(env, separators=(',', ':')).encode()) <= 4096, 'AWS_ENVIRONMENT_JSON_SIZE_LIMIT'
        manifest['functions'].append({'name': c['FunctionName'], 'arn': c['FunctionArn'], 'env': {**env, 'AWS_REGION': 'us-east-1'}})
    for name, obj in [('before.private.json', rows), ('candidate.private.json', manifest), ('scope.private.json', candidate)]:
        p = OUT / name
        p.write_text(json.dumps(obj, default=str, indent=2))
        p.chmod(0o600)
    subprocess.run(['node', 'scripts/check-finance-rollout-deployment.cjs', str(OUT / 'candidate.private.json')], cwd=ROOT, check=True, capture_output=True)
    attempt = {'schemaVersion': 1, 'userId': selector['userId'], 'branchId': selector['branchId'], 'requestId': selector['requestId']}
    defines['FINANCE_TEST_CHECKOUT_ATTEMPT'] = json.dumps(attempt, separators=(',', ':'))
    p = OUT / 'user-dart-defines.private.json'
    p.write_text(json.dumps(defines))
    p.chmod(0o600)
    result = {'prepared': True, 'executed': False, 'hosts': len(rows), 'newOrders': 1, 'preservedDeliveredScope': True, 'retiredUnfundedScopesAfterTerminalAudit': 1, 'discountPercent': 10, 'merchantFundsEntireDiscount': True, 'applicationWrites': False}
    if '--execute' in sys.argv:
        for c, f in zip(rows, manifest['functions']):
            env = {k: v for k, v in f['env'].items() if k != 'AWS_REGION'}
            current = lam.get_function_configuration(FunctionName=c['FunctionName'])
            assert current['RevisionId'] == c['RevisionId'], 'LIVE_DRIFT'
            lam.update_function_configuration(FunctionName=c['FunctionName'], RevisionId=c['RevisionId'], Environment={'Variables': env})
            lam.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'], WaiterConfig={'Delay': 1, 'MaxAttempts': 90})
            after = lam.get_function_configuration(FunctionName=c['FunctionName'])
            assert after['CodeSha256'] == c['CodeSha256'] and after['Environment']['Variables'] == env
            print(json.dumps({'configured': c['FunctionName']}), flush=True)
        result['executed'] = True
    (OUT / 'publication.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
