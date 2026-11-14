"""Enable only settlement schedule administration on the two staging hosts."""
import argparse
import datetime
import importlib.util
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance114')
FLAG = 'SETTLEMENT_SCHEDULE_ADMIN_ENABLED'
NAMES = ['staging-wizz-staff-service', 'order-receiver-regional-staging-unified-auth-v4-sam']


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    lam = module.session().client('lambda')
    expected = {r['name']: r for r in json.loads((ROOT / 'docs/finance-merchant-settlement-staging-release-113.json').read_text())['publication']['functions']}
    OUT.mkdir(mode=0o700, exist_ok=True)
    before = {}
    for name in NAMES:
        cfg = lam.get_function_configuration(FunctionName=name)
        assert cfg['CodeSha256'] == expected[name]['codeSha256'], 'CODE_DRIFT'
        assert cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
        assert 'Error' not in cfg.get('Environment', {}), 'ENVIRONMENT_UNAVAILABLE'
        env = cfg.get('Environment', {}).get('Variables', {})
        assert env.get(FLAG) in (None, 'false', 'true'), 'UNKNOWN_GATE_VALUE'
        next_env = {**env, FLAG: 'true'}
        assert sum(len(k.encode()) + len(v.encode()) for k, v in next_env.items()) < 4096
        before[name] = cfg
    print(json.dumps({'hosts': NAMES, 'onlyChangedVariable': FLAG, 'targetValue': 'true', 'execute': args.execute}), flush=True)
    if not args.execute:
        return
    backup = OUT / 'before.private.json'
    if not backup.exists():
        backup.write_text(json.dumps(before, default=str))
        backup.chmod(0o600)
    rows = []
    for name, cfg in before.items():
        env = cfg.get('Environment', {}).get('Variables', {})
        wanted = {**env, FLAG: 'true'}
        if env != wanted:
            lam.update_function_configuration(FunctionName=name, RevisionId=cfg['RevisionId'], Environment={'Variables': wanted})
            lam.get_waiter('function_updated_v2').wait(FunctionName=name, WaiterConfig={'Delay': 2, 'MaxAttempts': 30})
        after = lam.get_function_configuration(FunctionName=name)
        assert after['Environment']['Variables'] == wanted
        assert all(after.get(k) == cfg.get(k) for k in ['CodeSha256', 'Role', 'Runtime', 'Handler', 'MemorySize', 'Timeout', 'VpcConfig', 'Layers'])
        rows.append({'name': name, 'codeSha256': after['CodeSha256'], 'revisionId': after['RevisionId'], 'scheduleAdminEnabled': True, 'otherEnvironmentPreserved': True})
        evidence = {'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'functions': rows, 'applicationRowsWritten': False, 'payoutEnabled': False}
        (OUT / 'activation.json').write_text(json.dumps(evidence, indent=2))
        (OUT / 'activation.json').chmod(0o600)
        print(json.dumps({'enabled': name}), flush=True)
    payload = {'action': 'settlement_schedule_owner', 'accessToken': 'invalid-verification-token', 'httpMethod': 'GET', 'input': {'branchId': 'verification-only'}}
    result = lam.invoke(FunctionName=NAMES[0], InvocationType='RequestResponse', Payload=json.dumps(payload).encode())
    body = json.loads(result['Payload'].read())
    assert body.get('statusCode') == 401, 'OWNER_AUTH_GUARD_FAILED'
    evidence['invalidOwnerTokenRejected'] = True
    (ROOT / 'docs/finance-settlement-schedule-activation-114.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'complete': True, 'invalidOwnerTokenRejected': True, 'applicationRowsWritten': False}))


if __name__ == '__main__':
    main()
