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

class BranchDeviceAuthorization(unittest.TestCase):
    def setUp(self):
        import io
        from unittest.mock import patch
        self.io = io
        self.calls = []
        self.response = {'principalId': 'device', 'policyDocument': {'Version': '2012-10-17', 'Statement': [{'Action': 'execute-api:Invoke', 'Effect': 'Allow', 'Resource': 'arn:method'}]}}
        os.environ['MERCHANT_DEVICE_AUTHORIZER_FUNCTION'] = 'synthetic-reader'
        self.addCleanup(lambda: os.environ.pop('MERCHANT_DEVICE_AUTHORIZER_FUNCTION', None))
        def invoke(**kwargs):
            self.calls.append(kwargs)
            return {'StatusCode': 200, 'Payload': io.BytesIO(auth.json.dumps(self.response).encode())}
        client = types.SimpleNamespace(invoke=invoke)
        self.patch = patch.object(auth.boto3, 'client', lambda service: client, create=True)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.event = {'headers': {'Authorization': 'Bearer opaque-device'}, 'httpMethod': 'GET', 'path': '/wallet/branch-device/balance', 'methodArn': 'arn:method'}

    def test_device_transport_uses_its_own_authority_and_passes_no_employee_or_owner_identity(self):
        auth.verify_token = lambda token: (_ for _ in ()).throw(AssertionError('must not treat device as person'))
        result = auth.lambda_handler(self.event, None)
        self.assertEqual(result['principalId'], 'device')
        payload = auth.json.loads(self.calls[0]['Payload'])
        self.assertEqual(payload, {'type': 'TOKEN', 'authorizationToken': 'Bearer opaque-device', 'methodArn': 'arn:method'})

    def test_statement_route_is_get_only_and_uses_the_same_exact_device_authority(self):
        result = auth.lambda_handler({**self.event, 'path': '/wallet/branch-device/sales-report'}, None)
        self.assertEqual(result['principalId'], 'device')
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler({**self.event, 'path': '/wallet/branch-device/statement', 'httpMethod': 'POST'}, None)
        self.assertEqual(len(self.calls), 1)

    def test_device_namespace_never_authorizes_a_financial_write_or_unknown_route(self):
        for method, path in [('POST', '/wallet/branch-device/request'), ('GET', '/wallet/branch-device/unknown')]:
            with self.assertRaisesRegex(Exception, 'Unauthorized'):
                auth.lambda_handler({**self.event, 'httpMethod': method, 'path': path}, None)
        self.assertEqual(self.calls, [])

    def test_transfer_routes_delegate_only_to_the_write_runtime_with_exact_methods(self):
        os.environ['MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION'] = 'synthetic-transfer'
        self.addCleanup(lambda: os.environ.pop('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION', None))
        methods = {'context':'GET', 'recipient':'GET', 'history':'GET', 'status':'GET', 'otp/send':'POST', 'otp/verify':'POST', 'request':'POST', 'cancel':'POST'}
        for action, method in methods.items():
            route = {**self.event, 'path':'/wallet/branch-device/transfers/' + action, 'httpMethod':method}
            auth.lambda_handler(route, None)
            self.assertEqual(self.calls[-1]['FunctionName'], 'synthetic-transfer')
            with self.assertRaisesRegex(Exception, 'Unauthorized'):
                auth.lambda_handler({**route, 'httpMethod':'DELETE' if method == 'POST' else 'POST'}, None)
        before = len(self.calls)
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler({**self.event, 'path':'/wallet/branch-device/transfers/approve', 'httpMethod':'POST'}, None)
        self.assertEqual(len(self.calls), before)
        self.response['policyDocument']['Statement'][0]['Resource'] = '*'
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler({**self.event, 'path':'/wallet/branch-device/transfers/context'}, None)
        os.environ.pop('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION')
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler({**self.event, 'path':'/wallet/branch-device/transfers/context'}, None)

    def test_missing_authority_and_a_wildcard_response_fail_closed(self):
        self.response['policyDocument']['Statement'][0]['Resource'] = '*'
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler(self.event, None)
        os.environ.pop('MERCHANT_DEVICE_AUTHORIZER_FUNCTION')
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler(self.event, None)

    def test_transfer_methods_delegate_only_to_finance_runtime(self):
        os.environ['MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION'] = 'synthetic-transfer'
        self.addCleanup(lambda: os.environ.pop('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION', None))
        for action, method in [('context','GET'),('recipient','GET'),('history','GET'),('status','GET'),('otp/send','POST'),('otp/verify','POST'),('request','POST'),('cancel','POST')]:
            event = {**self.event, 'path':'/wallet/branch-device/transfers/'+action, 'httpMethod':method}
            self.assertEqual(auth.lambda_handler(event, None)['principalId'], 'device')
            self.assertEqual(self.calls[-1]['FunctionName'], 'synthetic-transfer')
            self.assertEqual(auth.json.loads(self.calls[-1]['Payload']), {'type':'TOKEN','authorizationToken':'Bearer opaque-device','methodArn':'arn:method'})
            before = len(self.calls)
            with self.assertRaisesRegex(Exception, 'Unauthorized'):
                auth.lambda_handler({**event, 'httpMethod':'POST' if method=='GET' else 'GET'}, None)
            self.assertEqual(len(self.calls), before)
        auth.lambda_handler(self.event, None)
        self.assertEqual(self.calls[-1]['FunctionName'], 'synthetic-reader')

    def test_transfer_delegate_missing_or_policy_mismatch_fails_closed(self):
        os.environ.pop('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION', None)
        event = {**self.event, 'path':'/wallet/branch-device/transfers/request', 'httpMethod':'POST'}
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler(event, None)
        self.assertEqual(self.calls, [])
        os.environ['MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION'] = 'synthetic-transfer'
        self.addCleanup(lambda: os.environ.pop('MERCHANT_DEVICE_FINANCE_AUTHORIZER_FUNCTION', None))
        self.response['policyDocument']['Statement'][0]['Resource'] = 'arn:other-request'
        with self.assertRaisesRegex(Exception, 'Unauthorized'):
            auth.lambda_handler(event, None)
        for suffix in ['request/extra','unknown','../balance']:
            with self.assertRaisesRegex(Exception, 'Unauthorized'):
                auth.lambda_handler({**event, 'path':'/wallet/branch-device/transfers/'+suffix}, None)
        self.assertEqual(len(self.calls), 1)

if __name__ == '__main__': unittest.main()
