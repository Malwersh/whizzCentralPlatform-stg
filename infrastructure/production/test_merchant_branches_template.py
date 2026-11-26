import unittest
from prepare_merchant_branches import build

class BranchTemplateTests(unittest.TestCase):
    def test_disabled_and_production_only(self):
        t=build()
        self.assertTrue(all(r.get('Condition')=='IsProductionAccount' for r in t['Resources'].values()))
        self.assertEqual(t['Resources']['Function']['Properties']['Environment']['Variables']['BRANCH_API_ENABLED'],'false')
    def test_only_authenticated_expected_routes(self):
        r=build()['Resources']
        methods=[v['Properties'] for v in r.values() if v['Type']=='AWS::ApiGateway::Method']
        self.assertEqual(len(methods),8)
        self.assertTrue(all(v['AuthorizationType']=='COGNITO_USER_POOLS' for v in methods))
        self.assertEqual(len(r['AssetsDeploymentV1']['DependsOn']),8)
    def test_no_scan_delete_or_merchant_table_access(self):
        import json
        policies=build()['Resources']['Role']['Properties']['Policies']
        raw=json.dumps(policies)
        for forbidden in ['dynamodb:Scan','staging']:
            self.assertNotIn(forbidden,raw)
    def test_private_bucket_and_scoped_cleanup(self):
        r=build()['Resources']; p=r['AssetsBucket']['Properties']
        self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()))
        self.assertEqual(p['VersioningConfiguration']['Status'],'Enabled')
        statements=r['Role']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        deletes=[s for s in statements if 'dynamodb:DeleteItem' in s['Action']]
        self.assertEqual(len(deletes),1)
        self.assertEqual(deletes[0]['Condition']['ForAllValues:StringLike']['dynamodb:LeadingKeys'],['ACCOUNT_OPERATION#MERCHANT#*'])
    def test_versioned_artifact_and_scoped_invocation(self):
        r=build()['Resources']
        self.assertIn('S3ObjectVersion',r['Function']['Properties']['Code'])
        permissions=[v['Properties'] for v in r.values() if v['Type']=='AWS::Lambda::Permission']
        self.assertEqual(len(permissions),8)
        self.assertTrue(all('/production/' in v['SourceArn']['Fn::Sub'] and v['SourceAccount']=={'Ref':'AWS::AccountId'} for v in permissions))

if __name__=='__main__': unittest.main()
