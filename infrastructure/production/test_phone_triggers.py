import json
import unittest
from preflight import ROOT, validate_common
from prepare_phone_triggers import build

class PhoneTriggerInfrastructureTests(unittest.TestCase):
    def setUp(self):
        self.template, self.mapping = build()

    def test_isolation_and_reproducible_package(self):
        manifest = json.loads((ROOT / 'environment.json').read_text())
        self.assertEqual(validate_common(manifest, json.dumps(self.template)), [])
        self.assertEqual(self.template, json.loads((ROOT / 'phone-triggers.template.json').read_text()))
        self.assertLess(len(json.dumps(self.template, indent=2).encode()), 51200)

    def test_no_endpoints_or_users_and_delivery_disabled(self):
        self.assertFalse(self.mapping['otpEnabled'])
        self.assertFalse(self.mapping['apiEndpointsCreated'])
        self.assertEqual(self.template['Parameters']['CustomerOtpEnabled']['Default'], 'false')
        for name, resource in self.template['Resources'].items():
            self.assertNotIn(resource['Type'], ['AWS::ApiGateway::RestApi', 'AWS::Cognito::UserPoolUser'])
            if resource['Type'] == 'AWS::Lambda::Function':
                expected = {'Ref': name.removesuffix('ChallengeFunction') + 'OtpEnabled'}
                self.assertEqual(resource['Properties']['Environment']['Variables']['OTP_ENABLED'], expected)

    def test_fresh_secrets_do_not_contain_provider_credentials(self):
        for role in ['Customer', 'Driver', 'Merchant']:
            secret = self.template['Resources'][role + 'OtpSecret']
            generated = secret['Properties']['GenerateSecretString']
            self.assertEqual(json.loads(generated['SecretStringTemplate'])['apiKey'], '')
            self.assertEqual(generated['GenerateStringKey'], 'hmacKey')
            self.assertEqual(generated['PasswordLength'], 64)
            self.assertEqual(secret['DeletionPolicy'], 'Retain')

    def test_permissions_are_scoped_to_each_application(self):
        for role in ['Customer', 'Driver', 'Merchant']:
            props = self.template['Resources'][role + 'ChallengeRole']['Properties']
            statements = props['Policies'][0]['PolicyDocument']['Statement']
            actions = {a for s in statements for a in s['Action']}
            self.assertNotIn('dynamodb:Scan', actions)
            self.assertNotIn('dynamodb:DeleteItem', actions)
            self.assertNotIn('cognito-idp:AdminCreateUser', actions)
            secret = next(s for s in statements if 'secretsmanager:GetSecretValue' in s['Action'])
            self.assertEqual(secret['Resource'], {'Ref': role + 'OtpSecret'})
            invoke = self.template['Resources'][role + 'CognitoInvoke']['Properties']
            self.assertEqual(invoke['SourceAccount'], {'Ref': 'AWS::AccountId'})
            self.assertIn(role + 'PoolId', json.dumps(invoke['SourceArn']))
            self.assertTrue(all(s['Resource'] != '*' for s in statements))

    def test_merchant_proof_bundle_is_version_pinned(self):
        code = self.template['Resources']['MerchantChallengeFunction']['Properties']['Code']
        self.assertEqual(code['S3ObjectVersion'], {'Ref': 'MerchantArtifactVersion'})
        self.assertEqual(code['S3Key'], {'Ref': 'MerchantArtifactKey'})
        env = self.template['Resources']['MerchantChallengeFunction']['Properties']['Environment']['Variables']
        self.assertEqual(env['USER_POOL_CLIENT_ID'], '5l8ng11uudg146crop63926svq')
        statements = self.template['Resources']['MerchantChallengeRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        checks = [x for x in statements if 'dynamodb:ConditionCheckItem' in x['Action']]
        self.assertTrue(checks)
        self.assertTrue(any('ACCOUNT_LIFECYCLE#MERCHANT#' in json.dumps(x) for x in checks))
