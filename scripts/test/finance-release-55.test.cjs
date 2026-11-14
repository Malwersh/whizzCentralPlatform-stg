'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const {template}=require('../prepare-finance-rollout-infrastructure-55.cjs');
const {plan}=require('../prepare-finance-rollout-access-54.cjs');
const names=['WizzUser-CreateOrder-staging','staging-wizz-staff-service','staging-wizz-wallet-notification-worker','wizzcentral-notifications-staging-pushSendWaveOffer'];
const inv={account:'699561669180',region:'us-east-1',functions:names.map(name=>({name,role:'arn:aws:iam::699561669180:role/'+name}))};
test('CloudFormation owns only the four reviewed policies and never recreates the roles',()=>{
 const t=template(inv);assert.equal(Object.keys(t.Resources).length,4);
 assert.deepEqual(Object.values(t.Resources).map(r=>r.Properties.PolicyDocument),plan(inv).map(p=>p.policy));
 for(const r of Object.values(t.Resources)){assert.equal(r.Type,'AWS::IAM::Policy');assert.equal(r.Condition,'StagingAccountAndRegion');assert.equal(r.Properties.Roles.length,1);}
 assert.throws(()=>template({...inv,account:'other'}));
});
test('publisher fails closed for active or unknown modes and configured cohorts',()=>{
 const p=path.resolve(__dirname,'../publish-finance-scoped-staging-55.py');
 const program=`import importlib.util\ns=importlib.util.spec_from_file_location('pub',${JSON.stringify(p)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nassert m.closed({})=={}\nfor values in [{'DISPATCH_CYCLE_MODE':'REQUIRED'},{'DISPATCH_CYCLE_MODE':'CENTRAL'},{'DELIVERY_QUOTES_ENABLED':'true'},{'FINANCE_ROLLOUT_CONFIG':'configured'},{'COMMERCIAL_PRICING_MODE':'REQUIRED'}]:\n try:m.closed({'Environment':{'Variables':values}})\n except ValueError:pass\n else:raise AssertionError('active gate accepted')\n`;
 cp.execFileSync('python3',['-c',program]);
});
