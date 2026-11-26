import tempfile
import unittest
from pathlib import Path
from prepare_region_management import prepare, SOURCE, FILES
class ProductionRegions(unittest.TestCase):
    def test_isolated_tables_and_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = prepare(directory)
            repo = (Path(directory) / 'repository.js').read_text()
            self.assertNotIn('WizzCentral_', repo)
            self.assertEqual(len(manifest['tables']), 5)
            for table in manifest['tables']:
                self.assertIn(table, repo)
            for name in ['api-entry.js', 'worker-entry.js']:
                content = (Path(directory) / name).read_text()
                self.assertIn("PLATFORM_ENVIRONMENT!=='production'", content)
                self.assertIn('REGION_MANAGEMENT_ENABLED', content)
                self.assertIn('REGION_COMPOSITE_READERS_READY', content)
            self.assertFalse(manifest['managementEnabled'])
            self.assertEqual(manifest['recordsCopied'], 0)
    def test_business_engine_unchanged_and_source_untouched(self):
        before = {name: (SOURCE / name).read_bytes() for name in FILES}
        with tempfile.TemporaryDirectory() as directory:
            prepare(directory)
            for name in ['geometry.js', 'model.js', 'service.js', 'worker.js']:
                self.assertEqual((Path(directory) / name).read_bytes(), before[name])
            self.assertEqual(before, {name: (SOURCE / name).read_bytes() for name in FILES})
            with self.assertRaises(ValueError):
                prepare(directory)
if __name__ == '__main__':
    unittest.main()
