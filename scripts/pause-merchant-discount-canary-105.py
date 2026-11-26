"""Pause admission for test103 at the user's request; retain every processing pin."""
import copy
import datetime
import importlib.util
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance105')


def main():
    OUT.mkdir(exist_ok=True, mode=0o700)
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    session = capture.session()
    lam, db = session.client('lambda'), session.resource('dynamodb')
    names = json.loads(subprocess.check_output(['node', '-e', "console.log(JSON.stringify(require('./scripts/check-finance-rollout-deployment.cjs').FUNCTIONS))"], cwd=ROOT))
    before = [lam.get_function_configuration(FunctionName=n) for n in names]
    old = json.loads(before[0]['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG'])
    assert len(names) == 15 and all(json.loads(c['Environment']['Variables']['FINANCE_ROLLOUT_CONFIG']) == old for c in before)
    candidate = copy.deepcopy(old)
    selected = next(s for s in candidate['scopes'] if s['id'] == 'fattoush-merchant-discount-103')
    assert len(selected['orders']) == 1
    oid = selected['orders'][0]['orderId']
    assert not db.Table('WizzOrders').get_item(Key={'PK': 'ORDER#' + oid, 'SK': 'META'}, ConsistentRead=True).get('Item'), 'ORDER_CREATED_REQUIRES_REVIEW'
    selected['mode'] = 'DRAIN'
    raw = json.dumps(candidate, separators=(',', ':'))
    digest = subprocess.check_output(['node', '-e', "console.log(require('./backend/wallet-service/dist/deliveryQuoteRecord').quoteHash(JSON.parse(require('fs').readFileSync(0,'utf8'))))"], input=raw.encode(), cwd=ROOT).decode().strip()
    archive = OUT / 'before.private.json'
    archive.write_text(json.dumps(before, default=str))
    archive.chmod(0o600)
    for c in before:
        env = {**c['Environment']['Variables'], 'FINANCE_ROLLOUT_CONFIG': raw, 'FINANCE_ROLLOUT_SHA256': digest}
        if env == c['Environment']['Variables']:
            continue
        assert len(json.dumps(env, separators=(',', ':')).encode()) <= 4096
        lam.update_function_configuration(FunctionName=c['FunctionName'], RevisionId=c['RevisionId'], Environment={'Variables': env})
        lam.get_waiter('function_updated_v2').wait(FunctionName=c['FunctionName'], WaiterConfig={'Delay': 1, 'MaxAttempts': 90})
        after = lam.get_function_configuration(FunctionName=c['FunctionName'])
        assert after['CodeSha256'] == c['CodeSha256'] and after['Environment']['Variables'] == env
        print(json.dumps({'paused': c['FunctionName']}), flush=True)
    result = {'status': 'PAUSED_BY_USER_PENDING_OTP_DELIVERY', 'hosts': 15, 'testOrderExists': False,
              'processingPinsPreserved': True, 'codeChanged': False, 'financialDataChanged': False,
              'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (OUT / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
