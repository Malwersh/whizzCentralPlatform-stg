"""Explicit receipt runtime bindings; preparation does not deploy or enable funding."""
import json
from pathlib import Path
from prepare_funding_receipts import NAME, service_policy

ACCOUNT = '746727375268'
REGION = 'us-east-1'

def build():
    tables = {
        'WALLETS_TABLE': 'Wallets', 'LEDGER_TABLE': 'LedgerEntries',
        'HOLDS_TABLE': 'Holds', 'TOPUP_REQUESTS_TABLE': 'TopupRequests',
        'AUDIT_LOG_TABLE': 'AuditLog', 'IDEMPOTENCY_KEYS_TABLE': 'IdempotencyKeys',
        'ACCOUNT_DELETION_TABLE': 'AccountDeletion',
        'WALLET_LIFECYCLE_TABLE': 'WalletLifecycle',
        'WALLET_NOTIFICATIONS_TABLE': 'WalletNotifications', 'ORDERS_TABLE': 'Orders',
        'STAFF_TABLE': 'PlatformStaff', 'MERCHANT_PLATFORM_TABLE': 'MerchantPlatform',
        'CUSTOMERS_TABLE': 'Customers', 'MERCHANTS_TABLE': 'Merchants', 'DRIVERS_TABLE': 'Drivers',
    }
    identity = json.loads(Path(__file__).with_name('wallet-identity-bindings.json').read_text())
    if identity['accountId'] != ACCOUNT or identity['region'] != REGION:
        raise ValueError('Wallet identity account/region mismatch')
    pools = {role.upper() + '_USER_POOL_ID': row['poolId']
             for role, row in identity['identities'].items()}
    clients = {role.upper() + '_CLIENT_ID': row['clientId']
               for role, row in identity['identities'].items()}
    if len(set(clients.values())) != 4 or not all(clients.values()):
        raise ValueError('Four distinct production app clients are required')
    return {
        'accountId': ACCOUNT, 'region': REGION,
        'status': 'PREPARED_NOT_DEPLOYED',
        'environment': {'ENVIRONMENT': 'production', 'PLATFORM_ENVIRONMENT': 'production',
                        'REGION': REGION, **pools, **clients,
                        **{k: 'wizz-production-' + v for k, v in tables.items()},
                        'FUNDING_RECEIPTS_BUCKET': NAME},
        'receiptObjectPolicy': service_policy(),
        'deploymentRequirements': [
            'Verify target AWS account and all referenced tables before deployment',
            'Attach receipt policy only to the production wallet runtime role',
            'Preserve authenticated receipt ownership and finance authorization',
            'Keep manual funding disabled until production recipient is configured and verified',
            'Do not enable direct payment gateways without production credentials and validation',
        ],
    }

if __name__ == '__main__':
    Path(__file__).with_name('wallet-receipt-runtime.json').write_text(
        json.dumps(build(), indent=2) + '\n')
