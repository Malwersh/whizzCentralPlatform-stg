import unittest
from prepare_wallet_receipt_runtime import build


class WalletRuntimeTests(unittest.TestCase):
    def test_authorization_dependencies_are_explicit(self):
        env = build()['environment']
        self.assertEqual(env['STAFF_TABLE'], 'wizz-production-PlatformStaff')
        self.assertEqual(env['MERCHANT_PLATFORM_TABLE'], 'wizz-production-MerchantPlatform')
        for role in ('DRIVER', 'CUSTOMER', 'MERCHANT', 'ADMIN'):
            self.assertTrue(env[role + '_USER_POOL_ID'].startswith('us-east-1_'))
            self.assertTrue(env[role + '_CLIENT_ID'])
        self.assertEqual(env['REGION'], 'us-east-1')

    def test_app_clients_match_verified_identity_manifest(self):
        import json
        from pathlib import Path
        identities = json.loads(Path(__file__).with_name('wallet-identity-bindings.json').read_text())
        env = build()['environment']
        for role, identity in identities['identities'].items():
            self.assertEqual(env[role.upper() + '_CLIENT_ID'], identity['clientId'])

    def test_table_bindings_are_isolated_and_distinct(self):
        tables = [v for k, v in build()['environment'].items() if k.endswith('_TABLE')]
        self.assertEqual(len(tables), len(set(tables)))
        self.assertTrue(all(t.startswith('wizz-production-') for t in tables))

    def test_preparation_does_not_activate_funding(self):
        manifest = build()
        self.assertEqual(manifest['status'], 'PREPARED_NOT_DEPLOYED')
        self.assertNotIn('TRANSFER_OTP_SECRET_ARN', manifest['environment'])
        self.assertNotIn('SANDBOX_PAYMENTS_TABLE', manifest['environment'])


if __name__ == '__main__':
    unittest.main()
