import json
import unittest
from prepare_customer_checkout import build as checkout, order_reads
from verify_order_dependencies import check, REQUIRED, ACCOUNT

class OrderDependenciesTests(unittest.TestCase):
    def bindings(self):
        return {k: f'arn:aws:lambda:us-east-1:{ACCOUNT}:function:{v}' for k,v in REQUIRED.items()}
    def test_empty_is_blocked(self):
        self.assertEqual(len(check([], {})['blockers']), 4)
    def test_missing_deployment_is_blocked(self):
        self.assertFalse(check([], self.bindings())['readyForOrderDeployment'])
    def test_explicit_existing_targets(self):
        self.assertTrue(check(list(REQUIRED.values()), self.bindings())['readyForOrderDeployment'])
    def test_wrong_account_and_region(self):
        for old,new in [(ACCOUNT,'699561669180'),('us-east-1','us-east-2')]:
            bindings = {k:v.replace(old,new) for k,v in self.bindings().items()}
            self.assertFalse(check(list(REQUIRED.values()),bindings)['readyForOrderDeployment'])
    def test_alias_not_silently_accepted(self):
        bindings = {k:v+':staging' for k,v in self.bindings().items()}
        self.assertFalse(check(list(REQUIRED.values()),bindings)['readyForOrderDeployment'])
    def test_aws_objects_supported(self):
        self.assertTrue(check([{'FunctionName':v} for v in REQUIRED.values()],self.bindings())['readyForOrderDeployment'])
    def test_push_is_separate_and_scope_is_explicit(self):
        result = check(list(REQUIRED.values()), self.bindings())
        self.assertTrue(result['pushCredentialsDeferred'])
        self.assertIn('does not prove IAM',result['limitation'])

class CheckoutPolicyTests(unittest.TestCase):
    def test_policy_documents_fit_iam_limits_and_only_writes_are_transactional(self):
        resources = checkout(order_reads())['Resources']
        role = resources['CheckoutRole']['Properties']
        self.assertEqual(role['ManagedPolicyArns'], [{'Ref': 'CheckoutReadPolicy'}])
        reads = resources['CheckoutReadPolicy']['Properties']['PolicyDocument']
        writes = role['Policies'][0]['PolicyDocument']
        for policy, limit in [(reads, 6144), (writes, 10240)]:
            self.assertLess(len(json.dumps(policy, separators=(',', ':'))), limit)
        self.assertTrue(all(set(row['Action']) <= {
            'dynamodb:GetItem', 'dynamodb:Query', 'dynamodb:Scan',
            'logs:CreateLogStream', 'logs:PutLogEvents',
        } for row in reads['Statement']))
        for row in writes['Statement']:
            self.assertEqual(row['Condition']['StringEquals']['dynamodb:EnclosingOperation'],
                             'TransactWriteItems')

if __name__ == '__main__': unittest.main()
