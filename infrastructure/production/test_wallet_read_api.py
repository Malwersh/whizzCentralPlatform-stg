import json
import unittest
from prepare_wallet_read_api import build, DEPLOYMENT, ROUTES

class WalletReadApiTest(unittest.TestCase):
    def test_approved_authenticated_routes(self):
        methods = [v['Properties'] for v in build()['Resources'].values() if v['Type'] == 'AWS::ApiGateway::Method' and v['Properties']['HttpMethod'] != 'OPTIONS']
        self.assertEqual(len(methods), 10)
        self.assertTrue(all(m['HttpMethod'] in ('GET','POST','PUT') and m['AuthorizationType'] == 'CUSTOM' for m in methods))
        self.assertNotIn('/wallet/me', ROUTES.values())
    def test_browser_preflight_is_read_only_and_has_no_lambda_permission(self):
        r = build()['Resources']
        for name in ROUTES:
            method = r[name+'Options']['Properties']
            self.assertEqual(method['AuthorizationType'], 'NONE')
            self.assertEqual(method['Integration']['Type'], 'MOCK')
            headers = method['Integration']['IntegrationResponses'][0]['ResponseParameters']
            self.assertEqual(headers['method.response.header.Access-Control-Allow-Methods'], "'PUT,OPTIONS'" if name == 'SaveFundingConfig' else ("'POST,OPTIONS'" if name in ('AdminReceipt','ApproveTopup','RejectTopup') else "'GET,OPTIONS'"))
            self.assertEqual(headers['method.response.header.Access-Control-Allow-Origin'], "'https://production.dy2cvcjvju3cf.amplifyapp.com'")
            self.assertIn(name+'Options', r[DEPLOYMENT]['DependsOn'])
    def test_only_approved_post_routes(self):
        r=build()['Resources']
        self.assertEqual(r['AdminReceipt']['Properties']['HttpMethod'], 'POST')
        self.assertTrue(all(r[n]['Properties']['HttpMethod']=='GET' for n in ROUTES if n not in ('AdminReceipt','SaveFundingConfig','ApproveTopup','RejectTopup')))
    def test_transfer_settings_are_read_only(self):
        r = build()['Resources']
        self.assertEqual(ROUTES['TransferSettings'], '/wallet/funding/admin/transfer-settings')
        self.assertEqual(r['TransferSettings']['Properties']['HttpMethod'], 'GET')
        resource = r['TransferSettings']['Properties']['ResourceId']['Ref']
        self.assertEqual(r[resource]['Properties']['PathPart'], 'transfer-settings')
        for logical_id in r:
            self.assertRegex(logical_id, r'^[A-Za-z][A-Za-z0-9]+$')
        self.assertEqual(r['Stage']['Properties']['DeploymentId'], {'Ref': DEPLOYMENT})
        self.assertNotIn('/wallet/funding/admin/transfers', ROUTES.values())
    def test_browser_receives_authentication_and_server_errors(self):
        r = build()['Resources']
        for name in ['GatewayClientError', 'GatewayServerError']:
            self.assertIn('gatewayresponse.header.Access-Control-Allow-Origin', r[name]['Properties']['ResponseParameters'])
    def test_no_cache_or_identity_reuse(self):
        t = build()
        self.assertEqual(t['Resources']['Authorizer']['Properties']['AuthorizerResultTtlInSeconds'], 0)
        self.assertNotIn('staging', json.dumps(t))
    def test_account_fence(self):
        self.assertTrue(all(r['Condition'] == 'IsProductionAccount' for r in build()['Resources'].values()))
    def test_no_iam_or_data_mutation(self):
        self.assertFalse(any(r['Type'].startswith(('AWS::IAM', 'AWS::DynamoDB')) for r in build()['Resources'].values()))
    def test_exact_invoke_paths(self):
        r = build()['Resources']
        for name, path in ROUTES.items():
            self.assertTrue(r[name + 'Permission']['Properties']['SourceArn']['Fn::Sub'].endswith('/production/' + ('PUT' if name == 'SaveFundingConfig' else ('POST' if name in ('AdminReceipt','ApproveTopup','RejectTopup') else 'GET')) + path.replace('{topupId}', '*')))

if __name__ == '__main__': unittest.main()
