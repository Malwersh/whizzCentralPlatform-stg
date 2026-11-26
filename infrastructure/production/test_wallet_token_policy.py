import unittest
from prepare_wallet_receipt_runtime import build
from wallet_token_policy import validate_claims


class ProductionWalletClaims(unittest.TestCase):
    def setUp(self):
        self.env = build()['environment']

    def claims(self, role):
        return {'iss': 'https://cognito-idp.us-east-1.amazonaws.com/' + self.env[role.upper() + '_USER_POOL_ID'],
                'client_id': self.env[role.upper() + '_CLIENT_ID'], 'token_use': 'access', 'sub': 'verified-subject'}

    def test_each_application_is_bound_to_its_own_identity(self):
        for role in ('driver', 'customer', 'merchant', 'admin'):
            self.assertTrue(validate_claims(self.claims(role), role, self.env))
            for other in ('driver', 'customer', 'merchant', 'admin'):
                if other != role:
                    with self.assertRaises(ValueError):
                        validate_claims(self.claims(other), role, self.env)

    def test_id_tokens_unknown_clients_and_missing_subject_are_rejected(self):
        for patch in ({'token_use': 'id'}, {'client_id': 'staging-client'}, {'sub': ''}, {'iss': 'untrusted'}):
            with self.assertRaises(ValueError):
                validate_claims({**self.claims('driver'), **patch}, 'driver', self.env)

    def test_admin_cannot_fall_back_to_groups_without_staff_table(self):
        with self.assertRaises(ValueError):
            validate_claims(self.claims('admin'), 'admin', {**self.env, 'STAFF_TABLE': ''})
