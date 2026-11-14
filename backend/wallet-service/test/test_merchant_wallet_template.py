import unittest
from pathlib import Path
import yaml

class MerchantWalletBoundaries(unittest.TestCase):
    def test_reader_has_no_fund_mutations_and_no_pin_derivation_access(self):
        template = yaml.load(Path('template.yaml').read_text(), Loader=yaml.BaseLoader)
        reader = template['Resources']['MerchantDeviceWalletFunction']
        self.assertEqual(reader['Condition'], 'IsSandboxStaging')
        statements = template['Resources']['MerchantDeviceWalletRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        for rule in statements:
            actions = rule['Action'] if isinstance(rule['Action'], list) else [rule['Action']]
            self.assertFalse(set(actions) & {'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'secretsmanager:GetSecretValue'})
            if 'dynamodb:PutItem' in actions:
                if rule['Resource'].endswith('/staging-MerchantPlatform'):
                    self.assertEqual(rule['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'], ['BRANCH#*'])
                else:
                    self.assertIn('${AuditLogTableName}', rule['Resource'])
            if rule['Resource'].endswith('/staging-MerchantPlatform') and 'dynamodb:GetItem' in actions:
                conditions = rule['Condition']
                attributes = conditions['ForAllValues:StringEquals']['dynamodb:Attributes']
                self.assertNotIn('digest', attributes)
                self.assertNotIn('salt', attributes)
                self.assertEqual(conditions['StringEquals']['dynamodb:Select'], 'SPECIFIC_ATTRIBUTES')
        self.assertEqual(reader['Properties']['Role'], 'MerchantDeviceWalletRole.Arn')
        self.assertNotIn('Events', reader['Properties'])
        api_resources = {k:v for k,v in template['Resources'].items() if k.startswith('MerchantDeviceApi')}
        self.assertEqual(len(api_resources),13)
        self.assertEqual(sum(r['Type']=='AWS::ApiGateway::Method' for r in api_resources.values()),8)
        for resource in api_resources.values():
            self.assertEqual(resource['Condition'],'IsSandboxStaging')
            self.assertEqual(resource['DeletionPolicy'],'Retain')
            if resource['Type']=='AWS::ApiGateway::Method' and resource['Properties']['HttpMethod']=='GET':
                self.assertEqual(resource['Properties']['AuthorizationType'],'CUSTOM')
                self.assertEqual(resource['Properties']['AuthorizerId'],'2bqq12')
        scan = next(rule for rule in statements if rule['Action'] == 'dynamodb:Scan')
        self.assertTrue(scan['Resource'].endswith('/WizzOrders'))
        self.assertNotIn('customerPhone', scan['Condition']['ForAllValues:StringEquals']['dynamodb:Attributes'])
        identity = template['Resources']['WalletServiceApi']['Properties']['Auth']['Authorizers']['WalletAuthorizer']['Identity']
        self.assertEqual(identity['ReauthorizeEvery'], '0')

    def test_transfers_have_separate_scoped_write_role_and_no_wallet_creation_or_deletion(self):
        import json
        template = json.loads(Path('template.device-transfers.json').read_text())
        self.assertEqual(template['Parameters']['Environment']['AllowedValues'], ['staging'])
        writer = template['Resources']['MerchantDeviceFinanceFunction']
        self.assertEqual(writer['Properties']['Role'], {'Fn::GetAtt':['MerchantDeviceTransferRole','Arn']})
        policies=template['Resources']['MerchantDeviceTransferRole']['Properties']['Policies']
        for rule in policies[0]['PolicyDocument']['Statement']:
            actions = rule['Action'] if isinstance(rule['Action'], list) else [rule['Action']]
            self.assertNotIn('dynamodb:DeleteItem', actions)
            self.assertNotIn('dynamodb:*', actions)
            if '${WalletsTableName}' in str(rule['Resource']):
                self.assertNotIn('dynamodb:PutItem', actions)
                self.assertNotIn('WALLET#PLATFORM', str(rule))
            if 'CONFIG#TRANSFERS' in str(rule):
                self.assertEqual(set(actions), {'dynamodb:GetItem','dynamodb:ConditionCheckItem'})
            if '/staging-MerchantPlatform' in str(rule['Resource']) and 'dynamodb:GetItem' in actions:
                self.assertNotIn('digest', str(rule))
                self.assertNotIn('salt', str(rule))
        routes = [r['Properties'] for r in template['Resources'].values() if r['Type']=='AWS::ApiGateway::Method' and r['Properties']['HttpMethod']!='OPTIONS']
        self.assertEqual(len(routes), 8)
        for route in routes:
            self.assertEqual(route['AuthorizationType'], 'CUSTOM')
            self.assertEqual(route['AuthorizerId'], {'Ref':'WalletAuthorizerId'})
        self.assertNotIn('approve', str(routes))
        self.assertEqual(template['Resources']['TransferAuthorizerDelegate']['Properties']['PolicyDocument']['Statement'][0]['Resource'], {'Fn::GetAtt':['MerchantDeviceFinanceFunction','Arn']})
