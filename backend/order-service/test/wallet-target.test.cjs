const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/walletTarget.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, { exports: exportsObject, process });
const { walletTarget } = exportsObject;
test('staging preserves configured endpoint and legacy default', () => {
  assert.match(walletTarget({ ENVIRONMENT: 'staging' }), /\/dev$/);
  assert.equal(walletTarget({ ENVIRONMENT: 'staging', WALLET_SERVICE_URL: 'https://configured' }), 'https://configured');
});
for (const ENVIRONMENT of ['prod', 'production']) {
  test(`${ENVIRONMENT} rejects missing, mismatched and legacy wallet bindings`, () => {
    for (const WALLET_SERVICE_URL of [undefined, '', 'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/dev',
      'https://abcdefghij.execute-api.us-east-1.amazonaws.com/staging',
      'https://abcdefghij.execute-api.us-west-2.amazonaws.com/production',
      'https://abcdefghij.execute-api.us-east-1.amazonaws.com/production?redirect=1']) {
      assert.throws(() => walletTarget({ ENVIRONMENT, WALLET_SERVICE_API_ID: 'abcdefghij', WALLET_SERVICE_URL }),
        { message: 'PRODUCTION_WALLET_NOT_CONFIGURED', status: 503 });
    }
  });
  test(`${ENVIRONMENT} accepts explicitly paired production endpoint`, () => {
    const WALLET_SERVICE_URL = 'https://abcdefghij.execute-api.us-east-1.amazonaws.com/production';
    assert.equal(walletTarget({ ENVIRONMENT, WALLET_SERVICE_API_ID: 'abcdefghij', WALLET_SERVICE_URL }), WALLET_SERVICE_URL);
    assert.throws(() => walletTarget({ ENVIRONMENT, WALLET_SERVICE_API_ID: 'er7d8mkxi5',
      WALLET_SERVICE_URL: 'https://er7d8mkxi5.execute-api.us-east-1.amazonaws.com/production' }));
  });
}
