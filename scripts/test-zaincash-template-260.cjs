const y=require('../backend/wallet-service/node_modules/js-yaml'),fs=require('fs'),assert=require('node:assert/strict');
const schema=y.DEFAULT_SCHEMA.extend(['scalar','sequence','mapping'].map(kind=>new y.Type('!',{kind,multi:true,construct:data=>data})));
for(const file of ['backend/wallet-service/template.yaml','backend/account-deletion/template.yaml']){
 const value=y.load(fs.readFileSync(file,'utf8'),{schema});
 if(file.includes('wallet-service')){
  const f=value.Resources.WalletServiceFunction.Properties;
  assert.equal(f.Environment.Variables.ZAINCASH_RETURN_URL,'ZaincashReturnUrl');
  assert.equal(f.Environment.Variables.ZAINCASH_WEBHOOK_URL,'ZaincashWebhookUrl');
  const events=Object.entries(f.Events).filter(([n])=>n.startsWith('Zaincash'));assert.equal(events.length,1);assert.equal(events[0][1].Type,'ScheduleV2');
  const api=value.Resources.WalletServiceApi.Properties;assert.equal(api.MergeDefinitions,true);let count=0;
  for(const [path,methods]of Object.entries(api.DefinitionBody.paths))for(const operation of Object.values(methods)){count++;assert.equal(operation['x-amazon-apigateway-integration'].credentials,'ZaincashApiInvokeRole.Arn');assert.deepEqual(operation.security,path.endsWith('/notification')?[]:[{WalletAuthorizer:[]}]);}
  assert.equal(count,14);
  assert.ok(f.Policies.some(p=>p.Statement?.some(s=>s.Action.includes?.('secretsmanager:CreateSecret'))));
 }
 console.log('PASS TEMPLATE_WIRING',file);
}
