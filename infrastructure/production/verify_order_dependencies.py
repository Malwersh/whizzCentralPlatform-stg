"""Read-only readiness check. Accepts AWS list-functions JSON; never deploys."""
import argparse
import json
from pathlib import Path

ACCOUNT = '746727375268'
REQUIRED = {
    'wallet': 'wizz-production-wallet',
    'dispatch': 'wizz-production-dispatch',
    'financial_cancellation': 'wizz-production-financial-cancellation',
    'realtime': 'wizz-production-order-realtime',
}

def check(functions, bindings):
    """Names are explicit deployment targets, not guesses about existing services."""
    errors = []
    names = {item if isinstance(item, str) else item.get('FunctionName') for item in functions}
    for capability, name in REQUIRED.items():
        target = bindings.get(capability, '')
        prefix = f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:wizz-production-'
        if not isinstance(target, str) or not target.startswith(prefix) or ':' in target[len(prefix):] or '/' in target:
            errors.append({'dependency': capability, 'reason': 'EXPLICIT_PRODUCTION_ARN_REQUIRED'})
        elif target.rsplit(':', 1)[-1] not in names:
            errors.append({'dependency': capability, 'reason': 'FUNCTION_NOT_DEPLOYED'})
    return {'readyForOrderDeployment': not errors, 'blockers': errors,
            'pushCredentialsDeferred': True, 'readOnly': True,
            'limitation': 'Function presence does not prove IAM, API routes, or end-to-end readiness.'}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--functions', required=True)
    parser.add_argument('--bindings', required=True)
    args = parser.parse_args()
    raw = json.loads(Path(args.functions).read_text())
    functions = raw.get('Functions', []) if isinstance(raw, dict) else raw
    result = check(functions, json.loads(Path(args.bindings).read_text()))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(0 if result['readyForOrderDeployment'] else 1)
