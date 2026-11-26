"""Prepare the tested region engine for production without touching staging or AWS."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent.parent / 'backend/region-management'
TABLES = {
    'WizzCentral_Regions': 'wizz-production-Regions',
    'WizzCentral_RegionsDerived_staging': 'wizz-production-RegionsDerived',
    'WizzCentral_RegionIndex_staging': 'wizz-production-RegionIndex',
    'WizzCentral_RegionNeighbors_staging': 'wizz-production-RegionNeighbors',
    'WizzCentral_RegionAudit_staging': 'wizz-production-RegionAudit',
}
FILES = ['repository.js', 'model.js', 'geometry.js', 'shared-boundary.js', 'service.js', 'worker.js',
         'references.js',
         'api-entry.js', 'worker-entry.js', 'package.json', 'package-lock.json']
REFERENCE_TABLES = {
    'REGION_REFERENCE_ADDRESSES': 'Addresses',
    'REGION_REFERENCE_MERCHANTS': 'Merchants',
    'REGION_REFERENCE_MERCHANT_PLATFORM': 'MerchantPlatform',
    'REGION_REFERENCE_DRIVERS': 'Drivers',
    'REGION_REFERENCE_ORDERS': 'Orders',
}
REFERENCE_ENV = {key: 'wizz-production-' + name for key, name in REFERENCE_TABLES.items()}

def reference_count_policy(table_arn):
    return {
        'Sid': 'RegionReferenceCounts',
        'Effect': 'Allow',
        'Action': ['dynamodb:Scan'],
        'Resource': [table_arn(name) for name in REFERENCE_TABLES.values()],
        'Condition': {'StringEquals': {'dynamodb:Select': 'COUNT'}},
    }

def prepare(destination):
    destination = Path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Output must be empty; refusing to overwrite existing work')
    destination.mkdir(parents=True, exist_ok=True)
    manifest = {'accountId': '746727375268', 'environment': 'production',
                'status': 'PREPARED_NOT_DEPLOYED', 'recordsCopied': 0,
                'managementEnabled': False, 'compositeReadersReady': False,
                'files': {}, 'tables': list(TABLES.values()),
                'remaining': ['Deploy and verify authenticated production API adapter',
                              'RegionAudit table and index',
                              'Queue, worker recovery and scoped IAM',
                              'Production reader compatibility verification',
                              'Admin map editor integration and acceptance test']}
    for name in FILES:
        source = (SOURCE / name).read_bytes()
        content = source.decode()
        if name == 'repository.js':
            for old, new in sorted(TABLES.items(), key=lambda item: -len(item[0])):
                content = content.replace("'" + old + "'", "'" + new + "'")
        if name in ['api-entry.js', 'worker-entry.js']:
            old = "process.env.PLATFORM_ENVIRONMENT!=='staging'"
            if content.count(old) != 1:
                raise ValueError('Unexpected environment guard: ' + name)
            content = content.replace(old, "process.env.PLATFORM_ENVIRONMENT!=='production'")
        if name == 'worker-entry.js':
            content = content.replace("require('../staff-service/catalog')", "require('../driver-review/catalog')")
        data = content.encode()
        (destination / name).write_bytes(data)
        manifest['files'][name] = {'sourceSha256': hashlib.sha256(source).hexdigest(),
                                  'productionSha256': hashlib.sha256(data).hexdigest(),
                                  'adapted': data != source}
    for name in ['index.cjs', 'region-api.cjs']:
        data = (ROOT / 'region-management' / name).read_bytes()
        (destination / name).write_bytes(data)
        manifest['files'][name] = {'productionSha256': hashlib.sha256(data).hexdigest(), 'productionAdapter': True}
    (destination / 'source-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.output), indent=2))
