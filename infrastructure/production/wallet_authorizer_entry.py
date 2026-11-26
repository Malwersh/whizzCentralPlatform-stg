"""Production entry point packaged alongside the tested wallet authorizer."""
import os
import authorizer
from wallet_token_policy import validate_claims

_verify_signature = authorizer.verify_token


def verify_production_token(token):
    role, claims = _verify_signature(token)
    if not role or not claims:
        return None, None
    try:
        validate_claims(claims, role, os.environ)
    except ValueError:
        return None, None
    return role, claims


authorizer.verify_token = verify_production_token


def lambda_handler(event, context):
    return authorizer.lambda_handler(event, context)
