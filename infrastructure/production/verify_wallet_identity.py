"""Read-only production identity preflight. Never reads users or client secrets."""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def verify(bindings, read):
    if bindings['accountId'] != '746727375268' or bindings['region'] != 'us-east-1':
        raise ValueError('Unexpected production account or region')
    if read('sts', 'get-caller-identity')['Account'] != bindings['accountId']:
        raise ValueError('Wrong AWS account')
    identities = bindings['identities']
    if set(identities) != {'driver', 'admin', 'customer', 'merchant'}:
        raise ValueError('Four explicit identities required')
    for key in ('poolId', 'clientId'):
        if len({item[key] for item in identities.values()}) != 4:
            raise ValueError('Identity bindings must be distinct')
    pools = read('cognito-idp', 'list-user-pools', '--max-results', '60')['UserPools']
    for role, item in identities.items():
        if not any(pool['Id'] == item['poolId'] and pool['Name'] == item['poolName'] for pool in pools):
            raise ValueError('Production pool mismatch: ' + role)
        clients = read('cognito-idp', 'list-user-pool-clients', '--user-pool-id', item['poolId'], '--max-results', '60')['UserPoolClients']
        if not any(client['ClientId'] == item['clientId'] and client['ClientName'] == item['clientName'] and client['UserPoolId'] == item['poolId'] for client in clients):
            raise ValueError('Production app client mismatch: ' + role)
    return {'status': 'VERIFIED', 'accountId': bindings['accountId'], 'identitiesVerified': 4, 'cloudModified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', required=True)
    args = parser.parse_args()
    bindings = json.loads((ROOT / 'wallet-identity-bindings.json').read_text())
    def read(*command):
        return json.loads(subprocess.check_output(['aws', *command, '--profile', args.profile, '--region', bindings['region'], '--output', 'json'], text=True))
    print(json.dumps(verify(bindings, read)))
