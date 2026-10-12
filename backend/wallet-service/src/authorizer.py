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

# Cognito configuration
DRIVER_USER_POOL_ID = os.environ['DRIVER_USER_POOL_ID']
ADMIN_USER_POOL_ID = os.environ['ADMIN_USER_POOL_ID']
SERVICE_USER_POOL_ID = os.environ['SERVICE_USER_POOL_ID']
REGION = os.environ['REGION']

# JWK clients for token verification
jwk_clients = {
    'driver': PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{DRIVER_USER_POOL_ID}/.well-known/jwks.json'),
    'admin': PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{ADMIN_USER_POOL_ID}/.well-known/jwks.json'),
    'service': PyJWKClient(f'https://cognito-idp.{REGION}.amazonaws.com/{SERVICE_USER_POOL_ID}/.well-known/jwks.json'),
}

# RBAC rules: endpoint → allowed user types
RBAC_RULES = {
    'GET /wallet/funding/admin/transactions': ['admin'],
    'GET /wallet/funding/admin/wallets': ['admin'],
    'GET /wallet/funding/config': ['driver', 'admin'],
    'POST /wallet/funding/receipt': ['driver'],
    'POST /wallet/funding/payment': ['driver'],
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
    elif pool_id == SERVICE_USER_POOL_ID:
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
                'service': SERVICE_USER_POOL_ID,
            }
            
            expected_issuer = f'https://cognito-idp.{REGION}.amazonaws.com/{pool_ids[pool_type]}'
            if payload.get('iss') == expected_issuer:
                return pool_type, payload
                
        except Exception as e:
            # Try next pool
            continue
    
    return None, None

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
        
        # Check RBAC
        allowed_types = RBAC_RULES.get(endpoint, [])
        if user_type not in allowed_types:
            print(f"Access denied: {user_type} not in {allowed_types}")
            raise Exception('Forbidden')
        
        print(f"Access granted for {user_type}")
        
        # Build context based on user type
        context = {
            'userType': user_type,
            'userId': payload.get('sub'),
            'username': payload.get('username', ''),
        }
        
        # Add user-type specific fields
        if user_type == 'driver':
            context['driverId'] = payload.get('sub')
        elif user_type == 'admin':
            context['financeManager'] = 'finance_manager' in payload.get('cognito:groups', [])
            context['adminId'] = payload.get('sub')
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
        # Return 401 Unauthorized
        raise Exception('Unauthorized')
