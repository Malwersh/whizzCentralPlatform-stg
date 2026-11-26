"""Additional production wallet claim gate, applied after signature verification."""

def validate_claims(claims, role, environment):
    if role not in ('driver', 'customer', 'merchant', 'admin'):
        raise ValueError('Unsupported production wallet identity')
    prefix = role.upper()
    client = environment.get(prefix + '_CLIENT_ID')
    pool = environment.get(prefix + '_USER_POOL_ID')
    region = environment.get('REGION')
    if not client or not pool or region != 'us-east-1':
        raise ValueError('Production identity configuration is incomplete')
    if claims.get('iss') != f'https://cognito-idp.{region}.amazonaws.com/{pool}':
        raise ValueError('Unexpected issuer')
    if claims.get('token_use') != 'access' or claims.get('client_id') != client:
        raise ValueError('Unexpected application or token type')
    if not isinstance(claims.get('sub'), str) or not claims['sub'].strip():
        raise ValueError('Missing subject')
    if role == 'admin' and not environment.get('STAFF_TABLE'):
        raise ValueError('Production staff authorization is required')
    return True
