import json
import unittest
from prepare_region_infrastructure import build
class RegionInfrastructure(unittest.TestCase):
 def test_disabled_and_isolated(self):
  t=build();self.assertEqual(t['Parameters']['WorkerEnabled']['Default'],'false')
  self.assertTrue(all(r['Condition']=='IsProductionAccount' for r in t['Resources'].values()))
  for foreign in ['699561669180','031857856164','staging','WizzCentral_']:
   self.assertNotIn(foreign,json.dumps(t))
  self.assertEqual(t['Resources']['QueueConsumer']['Properties']['BatchSize'],1)
  self.assertIn('Fn::If',t['Resources']['Recovery']['Properties']['State'])
 def test_permissions_no_finance_or_wildcard(self):
  s=build()['Resources']['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
  for row in s:
   self.assertNotEqual(row['Resource'],'*')
   self.assertTrue(all(not a.endswith(':*') for a in row['Action']))
  counts=next(row for row in s if row.get('Sid')=='RegionReferenceCounts')
  self.assertEqual(counts['Action'],['dynamodb:Scan'])
  self.assertEqual(counts['Condition'],{'StringEquals':{'dynamodb:Select':'COUNT'}})
  text=json.dumps([row for row in s if row is not counts])
  for forbidden in ['Wallet','Drivers','Merchants','cognito-idp','s3:']:
   self.assertNotIn(forbidden,text)
 def test_audit_and_queue_durability(self):
  r=build()['Resources'];self.assertTrue(r['RegionAudit']['Properties']['DeletionProtectionEnabled'])
  self.assertTrue(r['RegionAudit']['Properties']['PointInTimeRecoverySpecification']['PointInTimeRecoveryEnabled'])
  self.assertEqual(r['Queue']['DeletionPolicy'],'Retain')
  self.assertGreaterEqual(r['Queue']['Properties']['VisibilityTimeout'],6*r['Worker']['Properties']['Timeout'])
  self.assertEqual(r['QueueConsumer']['Properties']['FunctionResponseTypes'],['ReportBatchItemFailures'])
if __name__=='__main__':unittest.main()
