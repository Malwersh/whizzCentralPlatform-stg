"""Read-only cutover inventory. Never invokes handlers or reads human order rows.

Run from the CentralPlatform Staging root. Output contains allowlisted modes only;
credentials, environment values, user profiles and download URLs are excluded.
"""
import argparse
import concurrent.futures
import datetime
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RELEASES = [
    'finance-cod-staging-release-26.json',
    'finance-cod-order-dependencies-staging-27.json',
    'finance-cod-legacy-fences-staging-28.json',
    'finance-cod-quote-readiness-staging-29.json',
    'finance-operating-limits-search-exhaustion-31.json',
    'finance-dispatch-closed-staging-release-49.json',
    'finance-dispatch-policy-host-retention-staging-50.json',
    'finance-scoped-staging-release-55.json',
    'finance-pricing-routing-staging-56.json',
    'finance-routing-binding-staging-57.json',
    'finance-commercial-writer-and-proposal-58.json',
    'finance-commercial-ui-staging-60.json',
    'finance-commercial-retention-staging-61.json',
    'finance-campaign-versioning-staging-62.json',
    'finance-coordinated-pricing-readers-staging-63.json',
    'finance-approved-sample-workflow-staging-64.json',
    'finance-direct-platform-workflow-staging-65.json',
    'finance-staff-page-load-fix-staging-66.json',
    'finance-wave-continuation-93.json',
    'finance-cod-integration-pricing-97.json',
    'finance-reception-notification-staging-99.json',
    'finance-uploaded-sounds-android-tracking-100.json',
    'finance-merchant-identity-import-104.json',
    'finance-merchant-settlement-staging-release-113.json',
    'otp-telegram-fallback-staging-116.json',
]
EXTRA_FUNCTIONS = ['WizzUser-DeliveryQuotes-staging']
MODES = {'OFF', 'REQUIRED', 'REQUESTS_ONLY', 'SAFE_INITIAL_LEGACY',
         'SAFE_LEGACY_RETRY', 'CENTRAL', 'UNCONFIGURED', 'true', 'false'}
RULES = [
    'staging-cod-lifecycle-CodIntegrationWorkerRetryInte-LlysduSg9yRo',
    'wavesystem-staging-WaveSystemHandleWaveTimeoutFunct-1R1fpHnuzYeM',
]


def published_versions():
    """Use publication results only, never preflight/base/candidate hashes."""
    versions = {}
    for filename in RELEASES:
        doc = json.loads((ROOT / 'docs' / filename).read_text())
        rows = doc.get('publication', [])
        if isinstance(rows, dict):
            rows = rows.get('functions', []) + [v for v in rows.values()
                if isinstance(v, dict) and 'name' in v and 'codeSha256' in v]
        for row in [*doc.get('functions', []), *rows]:
            actual = row.get('published') if isinstance(row.get('published'), dict) else row
            name = actual.get('name', row.get('name'))
            sha = actual.get('codeSha256')
            if name and sha:
                versions[name] = {'codeSha256': sha, 'evidence': filename}
    return versions


def main():
    import boto3
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    session = boto3.Session(profile_name='Wizz_stg_UserApp', region_name='us-east-1')
    account = session.client('sts').get_caller_identity()['Account']
    if account != '699561669180':
        raise RuntimeError('Unexpected AWS account')
    lam = session.client('lambda')
    expected = published_versions()

    def inspect(name):
        cfg = lam.get_function_configuration(FunctionName=name)
        if cfg['FunctionArn'] != f'arn:aws:lambda:us-east-1:{account}:function:{name}':
            raise RuntimeError('Unexpected function ARN')
        env = cfg.get('Environment', {}).get('Variables', {})
        gates = {}
        for key, value in env.items():
            allowed = (key.endswith('_MODE') and key.startswith(
                ('DISPATCH_', 'FINANCIAL_', 'DELIVERY_', 'PINNED_', 'COMMERCIAL_')))
            allowed = allowed or key == 'DELIVERY_QUOTES_ENABLED'
            if allowed:
                gates[key] = value if value in MODES else 'OTHER_CONFIGURED_VALUE'
        prior = expected.get(name)
        return {'name': name, 'handler': cfg['Handler'],
                'codeSha256': cfg['CodeSha256'], 'revisionId': cfg['RevisionId'],
                'timeoutSeconds': cfg['Timeout'], 'lastUpdateStatus': cfg.get('LastUpdateStatus'),
                'gates': gates, 'expectedPublication': prior,
                'matchesRecordedPublication': cfg['CodeSha256'] == prior['codeSha256'] if prior else None}

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        functions = list(pool.map(inspect, sorted(set(expected) | set(EXTRA_FUNCTIONS))))
    events = session.client('events')
    rules = []
    for name in RULES:
        row = events.describe_rule(Name=name)
        rules.append({'name': name, 'state': row['State'],
                      'schedule': row.get('ScheduleExpression'),
                      'targetArns': [t['Arn'] for t in events.list_targets_by_rule(Rule=name)['Targets']]})
    row = session.resource('dynamodb').Table('staging-PlatformStaff').get_item(
        Key={'pk': 'OPERATIONAL_SETTINGS#DELIVERY_OPERATIONS', 'sk': 'CURRENT'},
        ConsistentRead=True, ProjectionExpression='#v,policyVersion,#values',
        ExpressionAttributeNames={'#v': 'version', '#values': 'values'})['Item']
    values = row['values']
    report = {'schemaVersion': 1, 'checkedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'account': account, 'region': 'us-east-1', 'readOnly': True,
              'handlerInvocations': 0, 'humanRowsRead': False, 'activationPerformed': False,
              'functions': functions, 'rules': rules,
              'centralPolicy': {'version': int(row['version']), 'policyVersion': row.get('policyVersion'),
                  'dispatchSchemaVersion': int(values.get('dispatch', {}).get('schemaVersion', 0)),
                  'performanceMode': values.get('dispatch', {}).get('performanceMode'),
                  'limits': {k: int(values[k]) for k in ['quoteMaxPerCustomerPerMinute',
                      'driverOfferTtlSeconds', 'driverPositionMaxAgeSeconds',
                      'reassignmentWindowSeconds', 'maximumWaves']}},
              'limits': ['Package equality does not prove runtime adoption or end-to-end correctness.',
                         'Missing gates do not imply activation; inspect source defaults.',
                         'Mobile installed builds, provider delivery, IAM and row coverage are not verified here.',
                         'Hash drift requires review; it is not automatically a regression.']}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'functions': len(functions), 'hashDrift': [f['name'] for f in functions
          if f['matchesRecordedPublication'] is False], 'readOnly': True, 'activationPerformed': False}))


if __name__ == '__main__':
    main()
