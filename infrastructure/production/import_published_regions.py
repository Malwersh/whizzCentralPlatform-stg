"""Import the reviewed production coverage from staging without copying test areas."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import time

import boto3
from botocore.config import Config

TABLES = {
    'RegionIndex': ('WizzCentral_RegionIndex_staging', 'index_cell_id'),
    'RegionNeighbors': ('WizzCentral_RegionNeighbors_staging', 'neighbor_pair_id'),
    'RegionsDerived': ('WizzCentral_RegionsDerived_staging', 'regionId'),
    'Regions': ('WizzCentral_Regions', 'regionId'),
}
TEST_REGION = 'Rminqkzax2wn2x'


def connect(profile, account):
    credentials = json.loads(subprocess.check_output([
        'aws', '--profile', profile, 'configure', 'export-credentials', '--format', 'process',
    ]))
    session = boto3.Session(
        aws_access_key_id=credentials['AccessKeyId'],
        aws_secret_access_key=credentials['SecretAccessKey'],
        aws_session_token=credentials.get('SessionToken'), region_name='us-east-1',
    )
    if session.client('sts').get_caller_identity()['Account'] != account:
        raise RuntimeError('AWS account mismatch')
    return session.client('dynamodb', config=Config(max_pool_connections=12,
        retries={'mode': 'standard', 'max_attempts': 8}))


def read(db, table, key):
    return {
        row[key]['S']: row
        for page in db.get_paginator('scan').paginate(TableName=table, ConsistentRead=True)
        for row in page['Items']
    }


def field(row, key, kind='S'):
    return row.get(key, {}).get(kind)


def snapshot(source):
    data = {role: read(source, *spec) for role, spec in TABLES.items()}
    base, derived = data['Regions'], data['RegionsDerived']
    if TEST_REGION in base:
        if field(base[TEST_REGION], 'name_ar') != 'asdadadada' or any(
            field(row, 'parent_id') == TEST_REGION for row in base.values()
        ):
            raise ValueError('Excluded staging test region no longer matches the reviewed record')
        del base[TEST_REGION]
    data['RegionsDerived'] = {key: derived[key] for key in base}
    for key, row in base.items():
        level = int(field(row, 'level', 'N'))
        parent = field(row, 'parent_id')
        if (level == 0 and parent not in (None, '', 'ROOT', 'root')) or (
            level > 0 and (parent not in base or int(field(base[parent], 'level', 'N')) != level - 1)
        ):
            raise ValueError('Source hierarchy is inconsistent')
        if level > 0 and field(derived[key], 'parent_id') != parent:
            raise ValueError('Derived hierarchy is inconsistent')
    data['RegionIndex'] = {k: r for k, r in data['RegionIndex'].items() if field(r, 'regionId') in base}
    data['RegionNeighbors'] = {
        k: r for k, r in data['RegionNeighbors'].items()
        if all(field(r, ref) in base for ref in ('source_region_id', 'target_region_id'))
    }
    indexed = {field(row, 'regionId') for row in data['RegionIndex'].values()}
    if not indexed or any(field(r, 'level', 'N') == '3' and (k not in indexed or 'geometry' not in r)
                          for k, r in base.items()):
        raise ValueError('A delivery area is missing its boundary or spatial index')
    return data


def write_missing(db, table, rows, existing):
    missing = [row for key, row in rows.items() if key not in existing]

    def write_batch(chunk):
        pending = {table: [{'PutRequest': {'Item': row}} for row in chunk]}
        for attempt in range(12):
            pending = db.batch_write_item(RequestItems=pending).get('UnprocessedItems', {})
            if not pending:
                return
            time.sleep(min(0.1 * 2 ** attempt, 3))
        raise RuntimeError(f'Retry limit for {table}')

    with ThreadPoolExecutor(max_workers=10) as pool:
        list(pool.map(write_batch, (missing[i:i + 25] for i in range(0, len(missing), 25))))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    source = connect('Wizz_stg_UserApp', '699561669180')
    target = connect('Wizz_prod_UserApp', '746727375268')
    data = snapshot(source)
    current = {}
    for role, (_, key) in TABLES.items():
        name = 'wizz-production-' + role
        current[role] = read(target, name, key)
        if any(data[role].get(k) != row for k, row in current[role].items()):
            raise ValueError(f'Production already contains differing records in {name}')
    counts = {role: len(rows) for role, rows in data.items()}
    print('Reviewed rows:', counts, flush=True)
    if not args.apply:
        return
    for role, (_, key) in TABLES.items():
        name = 'wizz-production-' + role
        write_missing(target, name, data[role], current[role])
        if read(target, name, key) != data[role]:
            raise RuntimeError(f'Verification failed for {name}')
        print(f'Verified {name}: {counts[role]}', flush=True)
    if args.report:
        args.report.write_text(json.dumps({
            'sourceAccount': '699561669180', 'productionAccount': '746727375268',
            'verifiedCounts': counts, 'excludedTestRegionId': TEST_REGION,
            'orphanedSpatialLinksExcluded': True,
        }, indent=2) + '\n')


if __name__ == '__main__':
    main()
