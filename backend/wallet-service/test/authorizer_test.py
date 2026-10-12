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
