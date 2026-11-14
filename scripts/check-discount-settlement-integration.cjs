'use strict';
// Run after discount changes to detect unintended edits to the settlement baseline.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..', '..');
const manifest = require('../docs/discount-settlement-integration-20261022.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
for (const entry of manifest.protectedFiles) {
  const bytes = fs.readFileSync(path.join(root, entry.repository, entry.path));
  if (hash(bytes) !== entry.sha256) {
    throw Error(`Settlement baseline changed: ${entry.repository}/${entry.path}`);
  }
}
for (const entry of manifest.benefitLifecycleAdapters) {
  const source = fs.readFileSync(path.join(root, entry.repository, entry.path), 'utf8');
  const settlement = source.split(/(?<=\n)/)
    .filter(line => !line.includes('settlePlatformBenefit')).join('');
  if (hash(settlement) !== entry.settlementSourceSha256) {
    throw Error(`Review shared settlement adapter: ${entry.path}`);
  }
}
console.log(`Verified ${manifest.protectedFiles.length} settlement files and ${manifest.benefitLifecycleAdapters.length} benefit lifecycle adapters.`);
