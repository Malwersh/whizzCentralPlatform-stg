'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {prepare}=require('../prepare-finance-test-attempt-54.cjs');
const {plan,identity}=require('../prepare-finance-rollout-access-54.cjs');
const {financialPatch,codPatch}=require('../prepare-finance-scoped-release-54.cjs');
const {scopeEnv,orderId}=require('../../backend/wallet-service/test/helpers/finance-rollout-fixture.cjs');
const attempt={userId:'u1',customerSubjectId:'sub1',branchId:'branch',requestId:'abcdefab-1234-4123-8123-123456789abc'};
const env=()=>scopeEnv({orders:[{orderId:orderId(),branchId:'branch',customerSubjectId:'sub1'}]});
test('test build reuses canonical order ID and requires exact preapproved subject branch and profile binding',()=>{
 const r=prepare(env(),attempt);assert.equal(r.orderId,orderId());assert.equal(r.activationAuthorized,false);
 assert.equal(JSON.parse(r.defines.FINANCE_TEST_CHECKOUT_ATTEMPT).requestId,attempt.requestId);
 for(const change of [{userId:'other'},{customerSubjectId:'other'},{branchId:'other'},{requestId:'*'},{extra:true}])assert.throws(()=>prepare(env(),{...attempt,...change}));
 assert.throws(()=>prepare(scopeEnv({mode:'DRAIN'}),attempt));assert.throws(()=>prepare(env(),attempt,Date.parse('2100-01-01')));
});
test('proposed access is limited to four exact account roles and adds no money write or invoke permission',()=>{
 const names=['WizzUser-CreateOrder-staging','staging-wizz-staff-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer'];
 const inventory={account:'699561669180',region:'us-east-1',functions:names.map(name=>({name,role:'arn:aws:iam::699561669180:role/'+name}))};
 const rows=plan(inventory);assert.equal(rows.length,4);
 for(const p of rows)for(const s of p.policy.Statement){assert(s.Action.every(a=>['dynamodb:GetItem','dynamodb:ConditionCheckItem','dynamodb:Query','dynamodb:Scan'].includes(a)));assert([s.Resource].flat().every(r=>r.startsWith('arn:aws:dynamodb:us-east-1:699561669180:table/')));}
 const notice=rows.find(p=>p.name==='staging-wizz-wallet-notification-worker').policy.Statement[0];
 assert.deepEqual(notice.Condition['ForAllValues:StringEquals']['dynamodb:Attributes'],identity);
 assert.equal(notice.Condition.Null['dynamodb:Attributes'],'false');assert.throws(()=>plan({...inventory,account:'other'}));
});
test('financial patch retains the published money prefix and transplants only known adapter functions',()=>{
 let source=fs.readFileSync(path.resolve(__dirname,'../../backend/wallet-service/src/driverFinancialRuntime.ts'),'utf8');
 const ts=require('../../backend/wallet-service/node_modules/typescript');
 source=source.replace(/^import .*;\n/gm,'').replace(/\bexport\s+(?=async function|function)/g,'');
 let prior=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
 for(const c of ['DynamoDBClient','DynamoDBDocumentClient','CognitoIdentityProviderClient','SecretsManagerClient'])prior=prior.replace(new RegExp('\\b'+c+'\\b','g'),'publishedSDK.'+c);
 const prefix='// existing hold, ledger and COD implementations\nconst immutableMoney = 123;\n';
 const live=prefix+'// backend/wallet-service/src/driverFinancialRuntime.ts\n'+prior;
 const r=financialPatch(live,fs.readFileSync(path.resolve(__dirname,'../../backend/wallet-service/src/driverFinancialRuntime.ts'),'utf8'));
 assert(r.source.startsWith(prefix));assert.equal(r.proof.adapterFunctions.length,11);assert(r.source.includes("require('./finance-rollout').createFinanceRollout"));
 assert.throws(()=>financialPatch('changed',source));
});
test('COD integration changes only its DB adapter and retains both existing worker wrappers',()=>{
 const live='const money=123;\nasync function handler(event) { const db = import_lib_dynamodb3.DynamoDBDocumentClient.from(new import_client_dynamodb.DynamoDBClient({ region: "us-east-1" }), { marshallOptions: { removeUndefinedValues: true } }); return db; }\n// existing dispatch and review wrappers\n';
 const r=codPatch(live);assert(r.source.startsWith('const money=123;'));assert(r.source.endsWith('// existing dispatch and review wrappers\n'));assert(r.source.includes("require('./finance-rollout')"));
 assert.throws(()=>codPatch('async function handler() {}'));
});
