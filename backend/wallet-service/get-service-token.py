#!/usr/bin/env python3
"""
Get Service Token from Cognito with SECRET_HASH
"""
import base64
import hmac
import hashlib
import boto3
import json
import sys

# Configuration
USERNAME = "order-service-dev"
PASSWORD = "w^p,5^w=F;m:AX<B_#K,,5W7Lv+#%$B&"
CLIENT_ID = "536kaptb4mttprbravfh9gbbq0"
CLIENT_SECRET = "h3d5e14egk2mdvr98ci77h5gjl5lp21d8bits69k8dh9151cee"
USER_POOL_ID = "us-east-1_VTZMjCvuP"
REGION = "us-east-1"

def calculate_secret_hash(username, client_id, client_secret):
    """Calculate SECRET_HASH for Cognito"""
    message = bytes(username + client_id, 'utf-8')
    secret = bytes(client_secret, 'utf-8')
    dig = hmac.new(secret, msg=message, digestmod=hashlib.sha256).digest()
    return base64.b64encode(dig).decode()

def get_service_token():
    """Authenticate and get service token"""
    try:
        # Calculate SECRET_HASH
        secret_hash = calculate_secret_hash(USERNAME, CLIENT_ID, CLIENT_SECRET)
        
        print(f"🔑 Authenticating as: {USERNAME}")
        print(f"📍 User Pool: {USER_POOL_ID}")
        print(f"🔐 SECRET_HASH: {secret_hash[:20]}...")
        print()
        
        # Initialize Cognito client
        session = boto3.Session(profile_name='Wizz_dev_UserApp', region_name=REGION)
        client = session.client('cognito-idp')
        
        # Authenticate
        response = client.initiate_auth(
            AuthFlow='USER_PASSWORD_AUTH',
            ClientId=CLIENT_ID,
            AuthParameters={
                'USERNAME': USERNAME,
                'PASSWORD': PASSWORD,
                'SECRET_HASH': secret_hash
            }
        )
        
        # Extract token
        if 'AuthenticationResult' in response:
            token = response['AuthenticationResult']['AccessToken']
            print("✅ Authentication successful!")
            print(f"🎫 Token (first 50 chars): {token[:50]}...")
            print()
            print("=" * 60)
            print("Full Token:")
            print(token)
            print("=" * 60)
            return token
        else:
            print("❌ No AuthenticationResult in response")
            print(json.dumps(response, indent=2))
            return None
            
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == '__main__':
    token = get_service_token()
    sys.exit(0 if token else 1)
