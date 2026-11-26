import hashlib,io,json,tempfile,unittest,zipfile
from pathlib import Path
from deploy_admin_amplify_bundle import archive
class BundleTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);(self.root/'index.html').write_text('reviewed');self.manifest={'files':{'index.html':hashlib.sha256(b'reviewed').hexdigest()}}
 def tearDown(self):self.tmp.cleanup()
 def test_verified_archive(self):
  z=zipfile.ZipFile(io.BytesIO(archive(self.root,self.manifest)));self.assertEqual(z.namelist(),['index.html']);self.assertEqual(z.read('index.html'),b'reviewed')
 def test_changed_content_rejected(self):
  (self.root/'index.html').write_text('changed')
  with self.assertRaisesRegex(ValueError,'hash'):archive(self.root,self.manifest)
 def test_extra_file_rejected(self):
  (self.root/'env.js').write_text('unexpected')
  with self.assertRaisesRegex(ValueError,'file set'):archive(self.root,self.manifest)
 def test_missing_file_rejected(self):
  (self.root/'index.html').unlink()
  with self.assertRaises(ValueError):archive(self.root,self.manifest)
if __name__=='__main__':unittest.main()
