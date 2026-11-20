import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'authorizer_lambda'))
from identity_config import validate_identity_config


class ProductionIdentityConfig(unittest.TestCase):
    def configured(self):
        env = {'ENVIRONMENT': 'production', 'REGION': 'us-east-1'}
        for kind in ('DRIVER', 'ADMIN', 'CUSTOMER', 'MERCHANT'):
            env[kind + '_USER_POOL_ID'] = 'us-east-1_' + kind
            env[kind + '_CLIENT_ID'] = kind.lower() + '123'
        return env

    def test_staging_unchanged(self):
        validate_identity_config({'ENVIRONMENT': 'staging'})

    def test_explicit_production_bindings(self):
        validate_identity_config(self.configured())

    def test_every_pool_and_client_required(self):
        for kind in ('DRIVER', 'ADMIN', 'CUSTOMER', 'MERCHANT'):
            for suffix in ('_USER_POOL_ID', '_CLIENT_ID'):
                env = self.configured()
                del env[kind + suffix]
                with self.subTest(key=kind + suffix), self.assertRaises(ValueError):
                    validate_identity_config(env)

    def test_conflicting_environment_and_region(self):
        for change in ({'PLATFORM_ENVIRONMENT': 'staging'}, {'REGION': 'me-south-1'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                validate_identity_config({**self.configured(), **change})

    def test_role_identity_cannot_be_shared(self):
        for suffix in ('_USER_POOL_ID', '_CLIENT_ID'):
            env = self.configured()
            env['CUSTOMER' + suffix] = env['ADMIN' + suffix]
            with self.subTest(suffix=suffix), self.assertRaises(ValueError):
                validate_identity_config(env)

    def test_platform_selector_alone_enforces_production(self):
        with self.assertRaises(ValueError):
            validate_identity_config({'PLATFORM_ENVIRONMENT': 'production'})


if __name__ == '__main__':
    unittest.main()
