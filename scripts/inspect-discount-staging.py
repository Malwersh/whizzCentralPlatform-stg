#!/usr/bin/env python3
"""Read-only staging deployment inventory. Never reads environment variables or invokes handlers."""
import argparse
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ACCOUNT = '699561669180'
REGION = 'us-east-1'
PATTERN = re.compile(r'discount|promo|create.?order|cancel.?order|get.?business.?products|product.*management|merchant.*response|staff.service|order.service', re.I)

def candidates(rows):
    return [row for row in rows if 'staging' in row.get('FunctionName', '').lower() and PATTERN.search(row['FunctionName'])]

def aws(profile, *args):
    command = ['aws', *args, '--profile', profile, '--region', REGION, '--output', 'json', '--no-cli-pager']
    result = subprocess.run(command, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--profile', required=True)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    if not args.out.is_absolute():
        parser.error('--out must be absolute')
    if args.out.exists():
        parser.error('--out already exists; choose a fresh path')
    identity = aws(args.profile, 'sts', 'get-caller-identity')
    if identity.get('Account') != ACCOUNT:
        raise RuntimeError('Unexpected AWS account; inventory stopped before resource access')
    listing = aws(args.profile, 'lambda', 'list-functions', '--query',
        'Functions[].{FunctionName:FunctionName,FunctionArn:FunctionArn,Role:Role,Runtime:Runtime,Handler:Handler,Version:Version,LastModified:LastModified,CodeSha256:CodeSha256}')
    report = {'createdAt': datetime.now(timezone.utc).isoformat(), 'account': ACCOUNT, 'region': REGION,
              'profile': args.profile, 'readOnly': True, 'liveBusinessDataRead': False, 'functions': [], 'errors': []}
    for row in candidates(listing):
        name = row['FunctionName']
        try:
            versions = aws(args.profile, 'lambda', 'list-versions-by-function', '--function-name', name,
                '--query', 'Versions[].{Version:Version,CodeSha256:CodeSha256,LastModified:LastModified}')
            aliases = aws(args.profile, 'lambda', 'list-aliases', '--function-name', name,
                '--query', 'Aliases[].{Name:Name,FunctionVersion:FunctionVersion,RoutingConfig:RoutingConfig}')
            role = row['Role'].rsplit('/', 1)[-1]
            attached = aws(args.profile, 'iam', 'list-attached-role-policies', '--role-name', role)
            inline = aws(args.profile, 'iam', 'list-role-policies', '--role-name', role)
            report['functions'].append({**row, 'roleName': role, 'publishedVersions': versions, 'aliases': aliases,
                'attachedPolicyReferences': attached.get('AttachedPolicies', []), 'inlinePolicyNames': inline.get('PolicyNames', [])})
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            report['errors'].append({'function': name, 'message': str(error)})
    report['complete'] = bool(report['functions']) and not report['errors']
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x') as output:
        json.dump(report, output, indent=2)
        output.write('\n')
    print(json.dumps({'report': str(args.out), 'functions': len(report['functions']), 'complete': report['complete']}))
    return 0 if report['complete'] else 1

if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error))
