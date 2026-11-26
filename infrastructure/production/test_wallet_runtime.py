import unittest
from prepare_wallet_runtime import build
from prepare_order_financial_runtime import build as build_order
from preflight import ROOT, validate_common
import json
class WalletDeploymentTests(unittest.TestCase):
 def test_internal_only(self):
  t=build();self.assertFalse(any('ApiGateway' in r['Type'] or r['Type']=='AWS::Lambda::Permission' for r in t['Resources'].values()))
 def test_no_financial_writes(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  actions={a for s in statements for a in s['Action']}
  self.assertEqual({a for a in actions if a.startswith('dynamodb:')},{'dynamodb:GetItem','dynamodb:Query','dynamodb:Scan'})
  self.assertEqual({a for a in actions if a.startswith('s3:')},{'s3:GetObject'})
  self.assertFalse(any(a.startswith('secretsmanager:') for a in actions))
 def test_isolated_tables(self):
  env=build()['Resources']['Function']['Properties']['Environment']['Variables']
  self.assertTrue(all(v.startswith('wizz-production-') for k,v in env.items() if k.endswith('_TABLE')))
  self.assertEqual(env['MERCHANT_OWNER_FINANCIAL_LOCK_ENABLED'],'true')
 def test_account_fenced(self):
  self.assertTrue(all(r['Condition']=='IsProductionAccount' for r in build()['Resources'].values()))
 def test_no_wildcard_database_resources(self):
  for s in build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']:
   if any(a.startswith('dynamodb:') for a in s['Action']):
    self.assertTrue(s['Resource']['Fn::Sub'].endswith(('Wallets','LedgerEntries','IdempotencyKeys','TopupRequests/index/byStatus','WalletNotifications/index/ByDriver')))
    if 'dynamodb:Scan' in s['Action']:
     self.assertEqual(s['Condition']['StringEquals']['dynamodb:Select'],'SPECIFIC_ATTRIBUTES')
    else:self.assertIn('dynamodb:LeadingKeys',s['Condition']['ForAllValues:StringLike'])

 def test_receipt_read_is_scoped(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  receipt=[s for s in statements if 's3:GetObject' in s['Action']]
  self.assertEqual(len(receipt),1)
  self.assertEqual(receipt[0]['Resource']['Fn::Sub'],'arn:${AWS::Partition}:s3:::wizz-production-funding-receipts-${AWS::AccountId}-${AWS::Region}/receipts/*')
  self.assertEqual(receipt[0]['Condition'],{'StringEquals':{'s3:ResourceAccount':{'Ref':'AWS::AccountId'}}})

 def test_settings_read_is_scoped_to_exact_config_keys(self):
  statements=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  config_reads=[s for s in statements if s['Resource']['Fn::Sub'].endswith(':table/wizz-production-IdempotencyKeys')]
  self.assertTrue(all(s['Action']==['dynamodb:GetItem'] for s in config_reads))
  self.assertEqual(
   {key for s in config_reads for key in s['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys']},
   {'CONFIG#FUNDING','CONFIG#TRANSFERS','CONFIG#TRANSFERS_PENDING','CONFIG#WALLET_OPERATING_LIMITS','CONFIG#WALLET_OPERATING_LIMITS_PENDING'}
  )


class OrderFinancialDeploymentTests(unittest.TestCase):
 def test_host_is_disabled_and_admits_no_public_invocation(self):
  template=build_order()
  manifest=json.loads((ROOT/'environment.json').read_text())
  self.assertEqual(validate_common(manifest,json.dumps(template)),[])
  self.assertEqual(set(template['Resources']),{'Function','Role','LogGroup'})
  self.assertEqual(template['Parameters']['HostMode']['Default'],'OFF')
  self.assertEqual(template['Parameters']['HostMode']['AllowedValues'],['OFF','SCOPED','GENERAL'])
  self.assertEqual(template['Parameters']['RolloutConfig']['Default'],'{}')
  self.assertTrue(template['Parameters']['RolloutConfig']['NoEcho'])
  env=template['Resources']['Function']['Properties']['Environment']['Variables']
  self.assertEqual(env['FINANCE_GENERAL_RELEASE_MODE']['Fn::If'],
                   ['GeneralProductionOrderHost','REQUIRED','OFF'])
  self.assertEqual(template['Conditions']['GeneralProductionOrderHost']['Fn::And'],[
   {'Condition':'IsProductionAccount'},{'Fn::Equals':[{'Ref':'HostMode'},'GENERAL']}])
  self.assertEqual(env['FINANCIAL_DISPATCH_MODE']['Fn::If'][-1],'OFF')
  self.assertEqual(env['WAVE_OFFERS_TABLE'],'wizz-production-WaveOffers')

 def test_data_policy_is_conditional_and_all_mutations_require_transactions(self):
  policies=build_order()['Resources']['Role']['Properties']['Policies']
  self.assertEqual([action for statement in policies[0]['PolicyDocument']['Statement'] for action in statement['Action']],
                   ['logs:CreateLogStream','logs:PutLogEvents'])
  condition, policy, disabled=policies[1]['Fn::If']
  self.assertEqual(condition,'EnabledProductionOrderHost')
  self.assertEqual(disabled,{'Ref':'AWS::NoValue'})
  statements=policy['PolicyDocument']['Statement']
  supported={'GetItem','ConditionCheckItem','UpdateItem','PutItem'}
  for statement in statements:
   self.assertNotEqual(statement['Resource'],'*')
   action=statement['Action']
   if action.startswith('dynamodb:'):
    self.assertIn(action.split(':')[1],supported)
    self.assertIn(':table/wizz-production-',statement['Resource']['Fn::Sub'])
   if action in ('dynamodb:PutItem','dynamodb:UpdateItem'):
     self.assertEqual(statement['Condition']['StringEquals']['dynamodb:EnclosingOperation'],'TransactWriteItems')
   else:
    self.assertNotIn('dynamodb:EnclosingOperation',statement.get('Condition',{}).get('StringEquals',{}))
  self.assertEqual(len([s for s in statements if s['Action']=='cognito-idp:AdminGetUser'][0]['Resource']),3)
