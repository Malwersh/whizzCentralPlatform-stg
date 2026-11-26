import unittest
from bootstrap_admin import records,ACCOUNT,EMAIL
class BootstrapTests(unittest.TestCase):
 def test_pending_not_active(self):
  p,m,a=records('owner','arn:aws:sts::'+ACCOUNT+':assumed-role/Admin/session','2026-11-16T00:00:00Z');self.assertEqual(p['status'],'INVITED');self.assertTrue(p['mfaRequired']);self.assertEqual(p['approvalLimit'],0);self.assertEqual(p['email'],EMAIL);self.assertEqual(m['pk'],'BOOTSTRAP#ADMIN');self.assertEqual(a['after'],p);self.assertEqual(a['actorIdentityEvidence'],'AWS_STS_CALLER_AT_ACTION')
 def test_other_account_rejected(self):
  with self.assertRaises(ValueError):records('owner','arn:aws:sts::000000000000:assumed-role/Admin/test','now')
 def test_no_credentials_in_records(self):
  items=records('owner','arn:aws:sts::'+ACCOUNT+':assumed-role/Admin/session','now')
  for x in items:
   for k in x:self.assertNotIn(k.lower(),['password','temporarypassword','secret','accesstoken','refreshtoken'])
if __name__=='__main__':unittest.main()
