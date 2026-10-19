"""Repair one eager import in the live merchant auth package; no IAM/data changes."""
import copy
import base64
import hashlib
import importlib.util
import io
import json
import pathlib
import sys
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = pathlib.Path('/private/tmp/finance104')
FUNCTION = 'order-receiver-regional-staging-unified-auth-v4-sam'
ENTRY = 'shared/merchant-lifecycle.js'


def main():
    OUT.mkdir(exist_ok=True, mode=0o700)
    spec = importlib.util.spec_from_file_location('capture', ROOT / 'scripts/capture-financial-readers-63.py')
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    lam = capture.session().client('lambda')
    fn = lam.get_function(FunctionName=FUNCTION)
    before = fn['Configuration']
    blob = urllib.request.urlopen(fn['Code']['Location'], timeout=30).read()
    assert base64.b64encode(hashlib.sha256(blob).digest()).decode() == before['CodeSha256']
    old = zipfile.ZipFile(io.BytesIO(blob))
    source = old.read(ENTRY).decode()
    eager = "const {fenceMerchantOrderOperation,canonicalFinancialPreparation}=require('./legacy-order-policy');\n"
    marker = '    fenceMerchantOrderOperation(item,record);'
    assert source.count(eager) == 1 and source.count(marker) == 1
    fixed = source.replace(eager, '').replace(marker, '    // Load the financial writer policy only when writing an order.\n    ' + eager + marker)
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w') as new:
        for info in old.infolist():
            new.writestr(copy.copy(info), fixed.encode() if info.filename == ENTRY else old.read(info.filename))
    candidate = target.getvalue()
    new = zipfile.ZipFile(io.BytesIO(candidate))
    changed = [name for name in old.namelist() if old.read(name) != new.read(name)]
    assert changed == [ENTRY]
    assert all(old.read(name) == new.read(name) for name in old.namelist() if name != ENTRY)
    for name, value in [('before.zip', blob), ('candidate.zip', candidate), ('before.private.json', json.dumps(before, default=str).encode())]:
        path = OUT / name
        path.write_bytes(value)
        path.chmod(0o600)
    result = {'prepared': True, 'executed': False, 'changedEntries': changed, 'financialPolicyModified': False,
              'iamChanged': False, 'applicationDataChanged': False, 'environmentChanged': False}
    if '--execute' in sys.argv:
        lam.update_function_code(FunctionName=FUNCTION, RevisionId=before['RevisionId'], ZipFile=candidate)
        lam.get_waiter('function_updated_v2').wait(FunctionName=FUNCTION, WaiterConfig={'Delay': 1, 'MaxAttempts': 90})
        after = lam.get_function_configuration(FunctionName=FUNCTION)
        assert after['CodeSha256'] == base64.b64encode(hashlib.sha256(candidate).digest()).decode()
        for key in ['Role', 'Environment', 'Handler', 'Runtime', 'Timeout', 'MemorySize', 'Layers', 'Architectures', 'VpcConfig', 'TracingConfig']:
            assert before.get(key) == after.get(key), key
        result.update(executed=True, codeSha256=after['CodeSha256'], otherConfigurationPreserved=True)
    (OUT / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))


if __name__ == '__main__':
    main()
