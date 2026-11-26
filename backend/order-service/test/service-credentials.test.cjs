const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require.resolve('../src/serviceCredentials.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, { exports: exportsObject, process });
const { serviceCredentials } = exportsObject;
test('staging preserves outbound service credentials', () => {
 const value=serviceCredentials({SERVICE_COGNITO_CLIENT_ID:'legacy',SERVICE_PASSWORD:'test-only'});
 assert.equal(value.username,'order-service-dev'); assert.equal(value.clientId,'legacy');
});
for(const ENVIRONMENT of ['prod','production']) {
 const valid={ENVIRONMENT,SERVICE_CLIENT_ID:'productionclient123',SERVICE_USERNAME:'order-service-production',SERVICE_PASSWORD:'test-only'};
 test(`${ENVIRONMENT} rejects missing and conflicting service identity`,()=>{
  for(const change of [{SERVICE_CLIENT_ID:undefined},{SERVICE_CLIENT_ID:'5erchruuvc35dfrcpld2gaeiq3'},
   {SERVICE_USERNAME:undefined},{SERVICE_USERNAME:'order-service-dev'},{SERVICE_PASSWORD:''},
   {SERVICE_COGNITO_CLIENT_ID:'otherclient'}]) {
   assert.throws(()=>serviceCredentials({...valid,...change}),{message:'PRODUCTION_SERVICE_CREDENTIALS_NOT_CONFIGURED',status:503});
  }
 });
 test(`${ENVIRONMENT} uses same canonical client as incoming service verification`,()=>{
  assert.equal(serviceCredentials(valid).clientId,valid.SERVICE_CLIENT_ID);
  assert.equal(serviceCredentials({...valid,SERVICE_COGNITO_CLIENT_ID:valid.SERVICE_CLIENT_ID}).clientId,valid.SERVICE_CLIENT_ID);
 });
}
