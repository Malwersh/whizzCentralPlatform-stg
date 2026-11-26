"""Record coverage of an empty production merchant accrual index."""
import argparse
import base64
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
from zipfile import ZipFile

ACCOUNT = '746727375268'
DRIVER = 'wizz-production-driver-offers'
PLATFORM = 'wizz-production-MerchantPlatform'
HOLDS = 'wizz-production-Holds'
KEY = {'pk': {'S': 'SYSTEM#MERCHANT_ACCRUAL_INDEX'}, 'sk': {'S': 'COVERAGE'}}


def aws(profile, *args):
    output = subprocess.check_output(
        ['aws', '--profile', profile, '--region', 'us-east-1', '--output', 'json', *args], text=True,
    )
    return json.loads(output) if output.strip() else {}


def canonical_hash(value):
    canonical = json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def verify_producer(profile, artifact):
    with ZipFile(artifact) as bundle:
        code = bundle.read('index.js')
    if b'MERCHANT_ACCRUAL_INDEX_ENTRY' not in code or b'MERCHANT_ACCRUAL#' not in code:
        raise RuntimeError('The reviewed archive does not contain the merchant accrual producer')
    digest = hashlib.sha256(artifact.read_bytes()).digest()
    live = aws(profile, 'lambda', 'get-function-configuration', '--function-name', DRIVER, '--query',
               '{state:State,update:LastUpdateStatus,checksum:CodeSha256,role:Role,mode:Environment.Variables.FINANCE_GENERAL_RELEASE_MODE}')
    if (live['state'], live['update'], live['mode']) != ('Active', 'Successful', 'REQUIRED') or (
            live['checksum'] != base64.b64encode(digest).decode()):
        raise RuntimeError('The active producer differs from the reviewed archive')
    role = live['role'].rsplit('/', 1)[-1]
    policy = aws(profile, 'iam', 'get-role-policy', '--role-name', role, '--policy-name', 'ProductionDriverOffers')
    statements = policy['PolicyDocument']['Statement']
    for action in ('GetItem', 'PutItem'):
        if not any(s['Effect'] == 'Allow' and s['Resource'] == f'arn:aws:dynamodb:us-east-1:{ACCOUNT}:table/{PLATFORM}'
                   and 'dynamodb:' + action in s['Action']
                   and 'MERCHANT_ACCRUAL#*' in s['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys']
                   for s in statements):
            raise RuntimeError('The deployed producer cannot maintain the merchant accrual index')
    return digest.hex()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path, required=True)
    parser.add_argument('--profile', default='Wizz_prod_UserApp')
    parser.add_argument('--apply', action='store_true')
    opts = parser.parse_args()
    profile = opts.profile
    if aws(profile, 'sts', 'get-caller-identity')['Account'] != ACCOUNT:
        raise RuntimeError('Production AWS account required')

    producer_digest = verify_producer(profile, opts.artifact)
    counts = ('dynamodb', 'scan', '--consistent-read', '--select', 'COUNT')
    payable_count = aws(profile, *counts, '--table-name', HOLDS, '--filter-expression', 'sk = :sk',
                        '--expression-attribute-values', '{":sk":{"S":"MERCHANT_PAYABLE"}}')['Count']
    index_count = aws(profile, *counts, '--table-name', PLATFORM, '--filter-expression', 'begins_with(pk,:prefix)',
                      '--expression-attribute-values', '{":prefix":{"S":"MERCHANT_ACCRUAL#"}}')['Count']
    if payable_count or index_count:
        raise RuntimeError('Existing records require an evidence backfill and per-record verification')
    coverage = aws(profile, 'dynamodb', 'get-item', '--table-name', PLATFORM, '--consistent-read', '--key', json.dumps(KEY))
    report = {'producerSha256': producer_digest, 'merchantPayables': payable_count, 'accrualIndexRecords': index_count}
    if coverage.get('Item'):
        raise RuntimeError('A coverage record already exists')
    if opts.apply:
        value = {'pk': KEY['pk']['S'], 'sk': KEY['sk']['S'], 'kind': 'MERCHANT_ACCRUAL_INDEX_COVERAGE',
                 'schemaVersion': 1, 'status': 'COMPLETE', 'sourceInventory': canonical_hash([]), 'sourceCount': 0,
                 'completedAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                 'producerProof': f'{DRIVER}:{producer_digest}'}
        value['digest'] = canonical_hash(value)
        item = {key: {'N': str(v)} if isinstance(v, int) else {'S': v} for key, v in value.items()}
        aws(profile, 'dynamodb', 'put-item', '--table-name', PLATFORM, '--item', json.dumps(item),
            '--condition-expression', 'attribute_not_exists(pk)')
        verified = aws(profile, 'dynamodb', 'get-item', '--table-name', PLATFORM, '--consistent-read', '--key', json.dumps(KEY))
        if verified.get('Item') != item:
            raise RuntimeError('Could not verify the saved coverage record')
        report['coverageDigest'] = value['digest']
    print(json.dumps(report))


if __name__ == '__main__':
    main()
