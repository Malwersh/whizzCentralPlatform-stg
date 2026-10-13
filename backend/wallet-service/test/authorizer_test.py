import importlib.util
import os
import sys
import types
import unittest

os.environ.update(DRIVER_USER_POOL_ID='drivers', ADMIN_USER_POOL_ID='admins', SERVICE_USER_POOL_ID='services', REGION='us-east-1')
sys.modules['boto3'] = types.ModuleType('boto3')
jwt = types.ModuleType('jwt')
jwt.PyJWKClient = lambda url: None
sys.modules['jwt'] = jwt
spec = importlib.util.spec_from_file_location('wallet_authorizer', 'authorizer_lambda/authorizer.py')
auth = importlib.util.module_from_spec(spec)
spec.loader.exec_module(auth)

class FinanceAuthorization(unittest.TestCase):
    def invoke(self, role, groups, path, method):
        auth.verify_token = lambda token: (role, {'sub':'test-actor', 'cognito:groups':groups})
        return auth.lambda_handler({'headers':{'Authorization':'Bearer fixture'},'httpMethod':method,'path':path,'methodArn':'arn:aws:execute-api:us-east-1:123:api/staging/'+method+path}, None)

    def test_manager_permissions(self):
        for path,method in [('/wallet/topup/requests','GET'),('/wallet/topup/fixture/approve','POST'),('/wallet/topup/fixture/reject','POST'),('/wallet/funding/admin/config','PUT'),('/wallet/funding/admin/receipt','POST'),('/wallet/funding/admin/sandbox','GET'),('/wallet/funding/admin/sandbox','PUT')]:
            self.assertEqual(self.invoke('admin',['admins'],path,method)['policyDocument']['Statement'][0]['Effect'], 'Deny')
            result = self.invoke('admin',['admins','finance_manager'],path,method)
            self.assertTrue(result['context']['financeManager'])
            self.assertEqual(self.invoke('driver',['finance_manager'],path,method)['policyDocument']['Statement'][0]['Effect'], 'Deny')

    def test_driver_receipts_and_config(self):
        self.assertEqual(self.invoke('driver',[], '/wallet/funding/receipt','POST')['context']['driverId'], 'test-actor')
        self.invoke('driver',[], '/wallet/funding/config','GET')
        self.assertEqual(self.invoke('admin',['finance_manager'], '/wallet/funding/receipt','POST')['policyDocument']['Statement'][0]['Effect'], 'Deny')

    def test_sandbox_routes_require_driver_role(self):
        for path,method in [('/wallet/funding/sandbox/config','GET'),('/wallet/funding/sandbox','GET'),('/wallet/funding/sandbox/payment','POST'),('/wallet/funding/sandbox/check','POST')]:
            self.assertEqual(self.invoke('driver',[],path,method)['policyDocument']['Statement'][0]['Effect'],'Allow')
            self.assertEqual(self.invoke('admin',['finance_manager'],path,method)['policyDocument']['Statement'][0]['Effect'],'Deny')

if __name__ == '__main__': unittest.main()

class MobileTransferAuthorization(unittest.TestCase):
    def setUp(self):
        self.original_live = auth.verify_live_mobile
        auth.verify_live_mobile = lambda token, payload: None
        self.addCleanup(lambda: setattr(auth, 'verify_live_mobile', self.original_live))
        os.environ.update(DRIVER_CLIENT_ID='driver-client',CUSTOMER_CLIENT_ID='customer-client',MERCHANT_CLIENT_ID='merchant-client')
    def invoke(self,kind,client,path,method='GET',token_use='access'):
        auth.verify_token=lambda token:(kind,{'sub':'principal','auth_time':1,'client_id':client,'token_use':token_use})
        return auth.lambda_handler({'headers':{'Authorization':'Bearer valid'},'httpMethod':method,'path':path,'methodArn':'arn:test'},None)
    def test_mobile_routes_require_the_correct_access_token_client(self):
        for kind,client in [('driver','driver-client'),('customer','customer-client'),('merchant','merchant-client')]:
            self.assertEqual(self.invoke(kind,client,'/wallet/transfers/context')['policyDocument']['Statement'][0]['Effect'],'Allow')
            self.assertEqual(self.invoke(kind,'wrong-client','/wallet/transfers/context')['policyDocument']['Statement'][0]['Effect'],'Deny')
            self.assertEqual(self.invoke(kind,client,'/wallet/transfers/context',token_use='id')['policyDocument']['Statement'][0]['Effect'],'Deny')
    def test_customer_cannot_manage_merchant_finance_members_or_access_driver_wallet(self):
        self.assertEqual(self.invoke('customer','customer-client','/wallet/transfers/members','POST')['policyDocument']['Statement'][0]['Effect'],'Deny')
        self.assertEqual(self.invoke('customer','customer-client','/wallet/me')['policyDocument']['Statement'][0]['Effect'],'Deny')
    def test_revoked_mobile_session_is_denied_even_with_verified_token_claims(self):
        def revoked(token,payload):
            raise Exception('NotAuthorized')
        auth.verify_live_mobile=revoked
        with self.assertRaisesRegex(Exception,'Unauthorized'):
            self.invoke('driver','driver-client','/wallet/transfers/context')

    def test_transfer_otp_routes_allow_mobile_accounts_and_live_phone_context(self):
        auth.verify_live_mobile = lambda token, payload: {'phone_number_verified': 'true', 'phone_number': '+9647800000000'}
        for kind, client in [('driver','driver-client'),('customer','customer-client'),('merchant','merchant-client')]:
            for path in ['/wallet/transfers/otp/send','/wallet/transfers/otp/verify']:
                result = self.invoke(kind,client,path,'ANY')
                self.assertEqual(result['policyDocument']['Statement'][0]['Effect'],'Allow')
                self.assertEqual(result['context']['phoneVerified'],'true')

    def test_proxy_any_authorizes_only_explicit_mobile_paths_and_roles(self):
        self.assertEqual(self.invoke('customer','customer-client','/wallet/transfers/context','ANY')['policyDocument']['Statement'][0]['Effect'],'Allow')
        self.assertEqual(self.invoke('merchant','merchant-client','/wallet/transfers/accounts','ANY')['policyDocument']['Statement'][0]['Effect'],'Allow')
        self.assertEqual(self.invoke('customer','customer-client','/wallet/transfers/members','ANY')['policyDocument']['Statement'][0]['Effect'],'Deny')
        self.assertEqual(self.invoke('merchant','merchant-client','/wallet/transfers/unknown','ANY')['policyDocument']['Statement'][0]['Effect'],'Deny')

