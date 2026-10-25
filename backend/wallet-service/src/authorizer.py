"""
Lambda Authorizer for Wallet Service
Validates Cognito tokens and enforces RBAC
"""
import json
import jwt
import os
import boto3
from jwt import PyJWKClient
from typing import Dict, Any
from staff_policy import access as staff_access

# Cognito configuration
DRIVER_USER_POOL_ID = os.environ['DRIVER_USER_POOL_ID']
ADMIN_USER_POOL_ID = os.environ['ADMIN_USER_POOL_ID']
SERVICE_USER_POOL_ID = os.environ.get('SERVICE_USER_POOL_ID')  # Optional - using IAM auth for triggers
REGION = os.environ['REGION']

# JWK clients for token verification
jwk_clients = {
    'driver': PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{DRIVER_USER_POOL_ID}/.well-known/jwks.json'),
    'admin': PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{ADMIN_USER_POOL_ID}/.well-known/jwks.json'),
}

for kind, variable in [('customer','CUSTOMER_USER_POOL_ID'),('merchant','MERCHANT_USER_POOL_ID')]:
    if os.environ.get(variable):
        jwk_clients[kind] = PyJWKClient(f"https://cognito-idp.{REGION}.amazonaws.com/{os.environ[variable]}/.well-known/jwks.json")

# Add service pool only if configured
if SERVICE_USER_POOL_ID:
    jwk_clients['service'] = PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{SERVICE_USER_POOL_ID}/.well-known/jwks.json')

# RBAC rules: endpoint → allowed user types
RBAC_RULES = {
    'GET /wallet/transfers/notifications': ['customer'],
    'POST /wallet/transfers/notifications': ['customer'],
    'POST /wallet/transfers/otp/send': ['driver','customer','merchant'],
    'POST /wallet/transfers/otp/verify': ['driver','customer','merchant'],
    'POST /wallet/funding/admin/transfer-settings/cancel': ['admin'],
    'GET /wallet/funding/admin/transfer-settings': ['admin'],
    'POST /wallet/funding/admin/transfer-settings': ['admin'],
    'POST /wallet/funding/admin/transfer-settings/approve': ['admin'],
    'GET /wallet/funding/admin/transfers': ['admin'],
    'POST /wallet/transfers/cancel': ['driver','customer','merchant'],
    'POST /wallet/transfers/request': ['driver','customer','merchant'],
    'GET /wallet/transfers/context': ['driver','customer','merchant'],
    'GET /wallet/transfers/recipient': ['driver','customer','merchant'],
    'GET /wallet/transfers/history': ['driver','customer','merchant'],
    'GET /wallet/transfers/status': ['driver','customer','merchant'],
    'GET /wallet/transfers/accounts': ['merchant'],
    'GET /wallet/transfers/members': ['merchant'],
    'POST /wallet/transfers/members': ['merchant'],
    'POST /wallet/funding/admin/transfer': ['admin'],
    'POST /wallet/funding/admin/transfer/approve': ['admin'],
    'GET /wallet/funding/admin/reconciliation': ['admin'],
    'GET /wallet/funding/admin/transactions': ['admin'],
    'GET /wallet/funding/admin/wallets': ['admin'],
    'GET /wallet/funding/admin/owners': ['admin'],
    'GET /wallet/me/notifications': ['driver'],
    'GET /wallet/funding/config': ['driver', 'admin'],
    'POST /wallet/funding/receipt': ['driver'],
    'POST /wallet/funding/payment': ['driver'],
    'GET /wallet/funding/zaincash/config': ['driver'],
    'GET /wallet/funding/zaincash/payments': ['driver'],
    'POST /wallet/funding/zaincash/payment': ['driver'],
    'POST /wallet/funding/zaincash/check': ['driver'],
    'GET /wallet/funding/admin/zaincash': ['admin'],
    'PUT /wallet/funding/admin/zaincash': ['admin'],
    'POST /wallet/funding/admin/zaincash/test': ['admin'],
    'POST /wallet/funding/admin/zaincash/import-uat': ['admin'],
    'POST /wallet/funding/admin/zaincash/accept': ['admin'],
    'POST /wallet/funding/admin/zaincash/pilot': ['admin'],
    'POST /wallet/funding/admin/zaincash/recover': ['admin'],
    'POST /wallet/funding/admin/zaincash/resolve-uncreated': ['admin'],
    'GET /wallet/funding/admin/zaincash/payments': ['admin'],
    'GET /wallet/funding/sandbox/config': ['driver'],
    'GET /wallet/funding/sandbox': ['driver'],
    'POST /wallet/funding/sandbox/payment': ['driver'],
    'POST /wallet/funding/sandbox/check': ['driver'],
    'GET /wallet/funding/admin/sandbox': ['admin'],
    'PUT /wallet/funding/admin/sandbox': ['admin'],

    'PUT /wallet/funding/admin/config': ['admin'],
    'POST /wallet/funding/admin/receipt': ['admin'],
    # Driver endpoints
    'GET /wallet/me': ['driver'],
    'GET /wallet/me/transactions': ['driver'],
    'POST /wallet/topup/request': ['driver'],
    'GET /wallet/topup/my-requests': ['driver'],
    'GET /wallet/holds/active': ['driver'],
    'GET /wallet/settlement/driver': ['driver'],

    # Admin endpoints
    'POST /wallet/topup/{id}/approve': ['admin'],
    'POST /wallet/topup/{id}/reject': ['admin'],
    'GET /wallet/topup/requests': ['admin'],
    'GET /wallet/platform': ['admin', 'service'],  # Platform wallet access
    'POST /wallet/platform/create': ['admin', 'service'],  # Platform wallet creation
    'GET /wallet/{walletId}': ['admin'],

    # Service endpoints (internal use only)
    'POST /wallet/create': ['service'],  # Called by Cognito trigger or backend services
    'POST /wallet/funding/admin/lifecycle/retry': ['admin'],
    'GET /wallet/funding/admin/lifecycle': ['admin'],
    'POST /wallet/hold/create': ['service'],
    'POST /wallet/hold/{id}/release': ['service'],
    'POST /wallet/hold/{id}/capture': ['service'],
    'POST /wallet/settlement/settle': ['service'],
    'GET /wallet/settlement/order/{id}': ['service'],

    # Public endpoints
    'GET /health': ['driver', 'admin', 'service', 'public'],
}

def determine_user_type(token_payload: Dict[str, Any], pool_id: str) -> str:
    """Determine user type based on token and pool"""
    if pool_id == DRIVER_USER_POOL_ID:
        return 'driver'
    elif pool_id == ADMIN_USER_POOL_ID:
        return 'admin'
    elif SERVICE_USER_POOL_ID and pool_id == SERVICE_USER_POOL_ID:
        return 'service'
    else:
        return 'unknown'

def verify_token(token: str) -> tuple:
    """
    Verify JWT token from any of the three Cognito pools
    Returns: (user_type, payload) or (None, None) if invalid
    """
    # Try each pool
    for pool_type, jwk_client in jwk_clients.items():
        try:
            # Get signing key
            signing_key = jwk_client.get_signing_key_from_jwt(token)

            # Decode and verify
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256"],
                options={"verify_exp": True}
            )

            # Verify issuer matches pool
            pool_ids = {
                'driver': DRIVER_USER_POOL_ID,
                'admin': ADMIN_USER_POOL_ID,
                'customer': os.environ.get('CUSTOMER_USER_POOL_ID'),
                'merchant': os.environ.get('MERCHANT_USER_POOL_ID'),
            }
            if SERVICE_USER_POOL_ID:
                pool_ids['service'] = SERVICE_USER_POOL_ID

            expected_issuer = f'https://cognito-idp.{REGION}.amazonaws.com/{pool_ids[pool_type]}'
            if payload.get('iss') == expected_issuer:
                return pool_type, payload

        except Exception as e:
            # Try next pool
            continue

    return None, None

def verify_live_mobile(token, payload):
    user = boto3.client('cognito-idp', region_name=REGION).get_user(AccessToken=token)
    attributes = {item['Name']: item['Value'] for item in user.get('UserAttributes', [])}
    if attributes.get('sub') != payload.get('sub'):
        raise Exception('Forbidden')
    return attributes

def generate_policy(principal_id: str, effect: str, resource: str, context: Dict = None) -> Dict:
    """Generate IAM policy for API Gateway"""
    # Return policy for the specific resource being accessed
    # API Gateway will call authorizer for each unique endpoint
    policy = {
        'principalId': principal_id,
        'policyDocument': {
            'Version': '2012-10-17',
            'Statement': [{
                'Action': 'execute-api:Invoke',
                'Effect': effect,
                'Resource': resource
            }]
        }
    }

    if context:
        policy['context'] = context

    return policy

def lambda_handler(event, context):
    """
    Lambda Authorizer handler
    Validates token and enforces RBAC
    """
    try:
        print("Wallet authorization request")

        # Extract headers - REQUEST authorizer format
        # Event structure: event['headers'] OR event['requestContext']['http']['headers']
        headers = event.get('headers', {})
        if not headers and 'requestContext' in event:
            headers = event.get('requestContext', {}).get('http', {}).get('headers', {})

        # Handle case-insensitive header names
        auth_header = (
            headers.get('Authorization') or
            headers.get('authorization') or
            ''
        )

        # Extract token
        token = auth_header.replace('Bearer ', '').replace('bearer ', '')
        if not token:
            print("No token provided")

            raise Exception('Unauthorized')

        # Device endpoints delegate to their exact read or transfer runtime.
        # Never send opaque device credentials through the Cognito/person path.
        branch_path = event.get('path', '')
        if branch_path.startswith('/wallet/branch-device/'):
            return authorize_branch_device(event, auth_header)

        # Verify token
        user_type, payload = verify_token(token)
        if not user_type:
            print("Invalid token")
            raise Exception('Unauthorized')

        print(f"Verified user type: {user_type}")


        # Extract request info from REQUEST authorizer event
        # Different formats supported
        http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('path') or event.get('requestContext', {}).get('http', {}).get('path', '')

        # Normalize path for RBAC check (replace path parameters with {id})
        normalized_path = path

        # Special handling for specific endpoints first
        if path == '/wallet/topup/request' or path == '/wallet/topup/my-requests' or path == '/wallet/topup/requests':
            # These are fixed paths, not parameterized
            normalized_path = path
        elif '/wallet/topup/' in path and (path.endswith('/approve') or path.endswith('/reject')):
            # /wallet/topup/abc123/approve → /wallet/topup/{id}/approve
            # /wallet/topup/abc123/reject → /wallet/topup/{id}/reject
            parts = path.split('/')
            if len(parts) >= 5:
                parts[3] = '{id}'
                normalized_path = '/'.join(parts)
        elif '/wallet/hold/' in path and not path.endswith('/create'):
            # /wallet/hold/abc123/release → /wallet/hold/{id}/release
            # BUT: /wallet/hold/create stays as-is
            parts = path.split('/')
            if len(parts) >= 4:
                parts[3] = '{id}'
                normalized_path = '/'.join(parts)
        elif '/wallet/settlement/order/' in path:
            # /wallet/settlement/order/abc123 → /wallet/settlement/order/{id}
            parts = path.split('/')
            if len(parts) >= 5:
                parts[4] = '{id}'
                normalized_path = '/'.join(parts)
        elif path.startswith('/wallet/') and path != '/wallet/me' and path != '/wallet/platform' and path != '/wallet/create':
            # /wallet/driver-123 → /wallet/{walletId}
            parts = path.split('/')
            if len(parts) == 3:
                normalized_path = '/wallet/{walletId}'

        endpoint = f"{http_method} {normalized_path}"
        print(f"Checking endpoint: {endpoint}")

        # Money transfers accept only access tokens from the designated app client.
        if '/transfer' in normalized_path or normalized_path.startswith('/wallet/funding/zaincash/'):
            expected_client = os.environ.get({'driver':'DRIVER_CLIENT_ID','admin':'ADMIN_CLIENT_ID','customer':'CUSTOMER_CLIENT_ID','merchant':'MERCHANT_CLIENT_ID'}.get(user_type,''))
            if not expected_client or payload.get('token_use') != 'access' or payload.get('client_id') != expected_client:
                raise Exception('Forbidden')

        # Check RBAC
        allowed_types = RBAC_RULES.get(endpoint, [])
        # REST API proxy methods arrive as ANY. Only the explicit mobile paths
        # use this union; the handler enforces the actual verb and ownership.
        if http_method == 'ANY' and normalized_path.startswith('/wallet/transfers/'):
            allowed_types = sorted(set(kind for verb in ('GET', 'POST')
                                       for kind in RBAC_RULES.get(f'{verb} {normalized_path}', [])))
        if user_type not in allowed_types:
            print(f"Access denied: {user_type} not in {allowed_types}")
            raise Exception('Forbidden')

        mobile_attributes = {}
        if ('/transfers/' in normalized_path or normalized_path.startswith('/wallet/funding/zaincash/')) and user_type in ('driver', 'customer', 'merchant'):
            mobile_attributes = verify_live_mobile(token, payload) or {}

        financial_endpoint = (normalized_path.startswith('/wallet/funding/admin/') or normalized_path == '/wallet/topup/requests' or normalized_path in ('/wallet/topup/{id}/approve', '/wallet/topup/{id}/reject'))
        employee, permissions = None, set()
        if user_type == 'admin' and os.environ.get('STAFF_TABLE'):
            employee, permissions = staff_access(payload, http_method, normalized_path, ADMIN_USER_POOL_ID)
        elif financial_endpoint and 'finance_manager' not in payload.get('cognito:groups', []):
            raise Exception('Forbidden')
        print(f"Access granted for {user_type}")

        # Build context based on user type
        context = {
            'userType': user_type,
            'userId': payload.get('sub'),
            'authTime': str(payload.get('auth_time', 0)),
            'username': payload.get('username', ''),
            'phoneVerified': 'true' if mobile_attributes.get('phone_number_verified') == 'true' else 'false',
            'verifiedPhone': mobile_attributes.get('phone_number', '') if mobile_attributes.get('phone_number_verified') == 'true' else '',
        }

        # Add user-type specific fields
        if user_type == 'driver':
            context['driverId'] = payload.get('sub')
        elif user_type == 'admin':
            context['adminId'] = payload.get('sub')
            context['financeManager'] = ('finance.read' in permissions) if employee else ('finance_manager' in payload.get('cognito:groups', []))
            if employee:
                context['staffVersion'] = str(employee['version'])
                context['staffPermissions'] = json.dumps(sorted(permissions))
        elif user_type == 'service':
            context['serviceId'] = payload.get('sub')
            context['serviceName'] = payload.get('custom:service_name', '')
            context['serviceRole'] = payload.get('custom:service_role', '')

        print(f"Returning context: {json.dumps(context)}")

        # Generate allow policy
        return generate_policy(
            principal_id=payload.get('username', payload.get('sub')),
            effect='Allow',
            resource=event['methodArn'],
            context=context
        )

    except Exception as e:
        print(f"Authorization failed: {str(e)}")
        if str(e) == 'Forbidden':
            return generate_policy(payload.get('sub', 'unknown'), 'Deny', event['methodArn'])
        raise Exception('Unauthorized')


def authorize_branch_device(event, auth_header):
    allowed_paths = ('/wallet/branch-device/balance', '/wallet/branch-device/transactions', '/wallet/branch-device/statement', '/wallet/branch-device/sales-report')
    finance_methods = {
        'context': 'GET', 'recipient': 'GET', 'history': 'GET', 'status': 'GET',
        'otp/send': 'POST', 'otp/verify': 'POST', 'request': 'POST', 'cancel': 'POST',
    }
    path = event.get('path', '')
    finance_prefix = '/wallet/branch-device/transfers/'
    finance_method = finance_methods.get(path[len(finance_prefix):]) if path.startswith(finance_prefix) else None
    if finance_method:
        function = os.environ.get('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION', '')
        route_allowed = event.get('httpMethod') == finance_method
    else:
        function = os.environ.get('MERCHANT_DEVICE_AUTHORIZER_FUNCTION', '')
        route_allowed = event.get('httpMethod') == 'GET' and path in allowed_paths
    if not function or not route_allowed or not auth_header.startswith('Bearer '):
        raise Exception('Unauthorized')
    method_arn = event.get('methodArn', '')
    response = boto3.client('lambda').invoke(
        FunctionName=function, InvocationType='RequestResponse',
        Payload=json.dumps({'type': 'TOKEN', 'authorizationToken': auth_header, 'methodArn': method_arn}).encode('utf-8'))
    if response.get('StatusCode') != 200 or response.get('FunctionError'):
        raise Exception('Unauthorized')
    result = json.loads(response['Payload'].read())
    statements = result.get('policyDocument', {}).get('Statement', [])
    if not result.get('principalId') or len(statements) != 1:
        raise Exception('Unauthorized')
    statement = statements[0]
    if statement.get('Action') != 'execute-api:Invoke' or statement.get('Effect') != 'Allow' or statement.get('Resource') != method_arn:
        raise Exception('Unauthorized')
    return result
