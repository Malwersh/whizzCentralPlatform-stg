import unittest
from prepare_funding_receipts import build, service_policy, NAME
class FundingReceiptStorageTests(unittest.TestCase):
    def test_storage_is_private_encrypted_retained(self):
        t=build(); r=t['Resources']['Documents']; p=r['Properties']
        self.assertEqual(p['BucketName'], NAME)
        self.assertEqual(r['Condition'], 'IsProductionAccount')
        self.assertEqual(r['DeletionPolicy'], 'Retain')
        self.assertEqual(r['UpdateReplacePolicy'], 'Retain')
        self.assertTrue(all(p['PublicAccessBlockConfiguration'].values()))
        self.assertEqual(p['OwnershipControls']['Rules'][0]['ObjectOwnership'],'BucketOwnerEnforced')
        self.assertEqual(p['VersioningConfiguration']['Status'],'Enabled')
        self.assertEqual(p['BucketEncryption']['ServerSideEncryptionConfiguration'][0]['ServerSideEncryptionByDefault']['SSEAlgorithm'],'AES256')
        self.assertNotIn('LifecycleConfiguration',p)
    def test_insecure_transport_denied(self):
        statement=build()['Resources']['TlsOnly']['Properties']['PolicyDocument']['Statement'][0]
        self.assertEqual(statement['Effect'],'Deny')
        self.assertEqual(statement['Condition']['Bool']['aws:SecureTransport'],'false')
    def test_future_service_access_is_object_only_and_account_bound(self):
        s=service_policy()['Statement'][0]
        self.assertEqual(set(s['Action']),{'s3:GetObject','s3:PutObject'})
        self.assertEqual(s['Resource'],f'arn:aws:s3:::{NAME}/receipts/*')
        self.assertEqual(s['Condition']['StringEquals']['s3:ResourceAccount'],'746727375268')
if __name__=='__main__': unittest.main()
