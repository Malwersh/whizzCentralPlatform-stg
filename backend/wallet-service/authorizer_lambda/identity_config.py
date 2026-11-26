"""Validate production wallet identity bindings before accepting requests."""
import re


def validate_identity_config(env):
    selectors = [env.get(key, '').strip().lower()
                 for key in ('ENVIRONMENT', 'PLATFORM_ENVIRONMENT')]
    if not any(value in ('prod', 'production') for value in selectors):
        return
    if any(value and value not in ('prod', 'production') for value in selectors):
        raise ValueError('Conflicting wallet identity environment')
    if env.get('REGION') != 'us-east-1':
        raise ValueError('Production wallet identity requires us-east-1')
    pools = []
    clients = []
    for kind in ('DRIVER', 'ADMIN', 'CUSTOMER', 'MERCHANT'):
        pool = env.get(kind + '_USER_POOL_ID', '')
        client = env.get(kind + '_CLIENT_ID', '')
        if not re.fullmatch(r'us-east-1_[A-Za-z0-9]+', pool):
            raise ValueError('Missing or invalid production identity pool: ' + kind)
        if not re.fullmatch(r'[a-z0-9]+', client):
            raise ValueError('Missing or invalid production identity client: ' + kind)
        pools.append(pool)
        clients.append(client)
    if len(set(pools)) != len(pools) or len(set(clients)) != len(clients):
        raise ValueError('Production wallet identities must be distinct')
