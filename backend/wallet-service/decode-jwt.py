#!/usr/bin/env python3
import base64
import json
import sys

def decode_jwt(token):
    """Decode JWT token (without verification)"""
    parts = token.split('.')
    if len(parts) != 3:
        print("Invalid token format")
        return None
    
    # Decode header
    header = json.loads(base64.urlsafe_b64decode(parts[0] + '=='))
    print("=" * 60)
    print("JWT HEADER:")
    print(json.dumps(header, indent=2))
    
    # Decode payload
    payload = json.loads(base64.urlsafe_b64decode(parts[1] + '=='))
    print("=" * 60)
    print("JWT PAYLOAD:")
    print(json.dumps(payload, indent=2))
    print("=" * 60)
    
    return payload

if __name__ == '__main__':
    if len(sys.argv) > 1:
        token = sys.argv[1]
    else:
        token = input("Enter JWT token: ").strip()
    
    decode_jwt(token)
