'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
test('routing grant is limited to the two actual hosts and one exact secret, with no credential writes',()=>{
 const bindings=JSON.parse(fs.readFileSync('backend/finance-routing-bindings.staging.json')),template=JSON.parse(fs.readFileSync('backend/finance-routing-access.staging.json'));
 assert.deepEqual(bindings.bindings.map(b=>b.functionName),['WizzUser-DeliveryQuotes-staging','WaveSystem_StartWave']);assert.equal(Object.keys(template.Resources).length,2);
 for(const r of Object.values(template.Resources)){assert.equal(r.Type,'AWS::IAM::Policy');assert.equal(r.Properties.Roles.length,1);assert.deepEqual(r.Properties.PolicyDocument.Statement,[{Effect:'Allow',Action:['secretsmanager:GetSecretValue'],Resource:bindings.secretArn}]);}
 assert.equal(bindings.activation,false);assert.deepEqual(bindings.mustNotReprice,['staging-driver-financial-accept','WaveSystem_HandleWaveTimeout']);
});
test('binding preflight rejects open or unknown modes and configured rollout scope',()=>{
 const file=path.resolve('scripts/bind-finance-routing-staging-57.py');
 const program=`import importlib.util\ns=importlib.util.spec_from_file_location('bind',${JSON.stringify(file)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.closed({})\nfor env in [{'DELIVERY_QUOTES_ENABLED':'true'},{'DELIVERY_QUOTES_ENABLED':'unknown'},{'DELIVERY_QUOTE_MODE':'REQUIRED'},{'FINANCIAL_DISPATCH_MODE':'REQUIRED'},{'FINANCIAL_DISPATCH_MODE':'unknown'},{'COMMERCIAL_PRICING_MODE':'REQUIRED'},{'FINANCE_ROLLOUT_CONFIG':'configured'}]:\n try:m.closed(env)\n except AssertionError:pass\n else:raise AssertionError('open configuration accepted')\n`;
 cp.execFileSync('python3',['-c',program]);
});
