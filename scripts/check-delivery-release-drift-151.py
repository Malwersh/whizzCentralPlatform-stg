"""Read-only release baseline comparison. Never writes to AWS."""
import datetime, hashlib, json, os, pathlib, subprocess, sys

BASE = pathlib.Path(sys.argv[1])
EXTRA = pathlib.Path(sys.argv[2])
OUT = pathlib.Path(sys.argv[3])
OUT.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(OUT, 0o700)

def aws(*args):
    p = subprocess.run(['aws', *args, '--profile', 'Wizz_stg_UserApp', '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], capture_output=True, text=True, timeout=90)
    if p.returncode:
        raise RuntimeError('READ_ONLY_DRIFT_CHECK_FAILED: ' + args[0] + '/' + args[1])
    return json.loads(p.stdout)

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))

assert aws('sts', 'get-caller-identity')['Account'] == '699561669180'
inventory = json.loads((BASE / 'inventory.private.json').read_text())
extra = json.loads((EXTRA / 'extra-inventory.private.json').read_text())
manifest = json.loads((EXTRA / 'package-manifest.json').read_text())
rows = []
for item in manifest['functions']:
    current = aws('lambda', 'get-function-configuration', '--function-name', item['name'])
    old = next((r for r in inventory['functions'] if r['name'] == item['name']), None)
    role = old['role'] if old else extra['notification']['Role']
    changes = [key for key, expected in [('CodeSha256', item['baseCodeSha256']), ('RevisionId', item['baseRevisionId']), ('Handler', item['handler']), ('Role', role)] if current.get(key) != expected]
    if old:
        env = current.get('Environment', {}).get('Variables', {})
        changes += ['flag:' + key for key, value in old['flags'].items() if env.get(key, 'ABSENT') != value]
    rows.append({'name': item['name'], 'drift': changes, 'state': current.get('State'), 'lastUpdateStatus': current.get('LastUpdateStatus')})

policies = []
for folder in [BASE, EXTRA]:
    for snapshot in sorted(folder.glob('*.policies.private.json')):
        old = json.loads(snapshot.read_text())
        role = old['arn'].rsplit('/', 1)[-1]
        current = {'arn': old['arn'], 'inline': [], 'managed': []}
        for name in aws('iam', 'list-role-policies', '--role-name', role)['PolicyNames']:
            current['inline'].append({'name': name, 'document': aws('iam', 'get-role-policy', '--role-name', role, '--policy-name', name)['PolicyDocument']})
        for policy in aws('iam', 'list-attached-role-policies', '--role-name', role)['AttachedPolicies']:
            version = aws('iam', 'get-policy', '--policy-arn', policy['PolicyArn'])['Policy']['DefaultVersionId']
            current['managed'].append({'arn': policy['PolicyArn'], 'version': version, 'document': aws('iam', 'get-policy-version', '--policy-arn', policy['PolicyArn'], '--version-id', version)['PolicyVersion']['Document']})
        for value in [old, current]:
            value['inline'].sort(key=lambda x: x['name'])
            value['managed'].sort(key=lambda x: x['arn'])
        policies.append({'role': role, 'changed': canonical(old) != canonical(current)})

jobs = aws('amplify', 'list-jobs', '--app-id', extra['frontend']['appId'], '--branch-name', 'staging', '--max-results', '10')['jobSummaries']
latest = next(j['jobId'] for j in jobs if j['status'] == 'SUCCEED')
report = {'part': 151, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'readOnly': True, 'applied': False, 'functions': rows, 'roles': policies, 'frontend': {'baselineJob': extra['frontend']['jobId'], 'latestSuccessfulJob': latest, 'activeJobs': [j['jobId'] for j in jobs if j['status'] in ['PENDING', 'PROVISIONING', 'RUNNING'] ]}}
report['clean'] = all(not r['drift'] and r['state'] == 'Active' and r['lastUpdateStatus'] == 'Successful' for r in rows) and not any(r['changed'] for r in policies) and latest == extra['frontend']['jobId'] and not report['frontend']['activeJobs']
target = OUT / 'drift-review.json'
target.write_text(json.dumps(report, indent=2) + '\n')
os.chmod(target, 0o600)
print(json.dumps(report))
sys.exit(0 if report['clean'] else 2)
