'use strict';
const fs=require('fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('../backend/wallet-service/node_modules/typescript');
const file=process.argv[2],s=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,s,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const helper=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='__correctionDb352');assert(helper);
const methods=new Map();function visit(n){if(ts.isMethodDeclaration(n)&&n.name&&['backend/staff-service/merchant-payouts.js','backend/staff-service/merchant-account.js'].includes(n.name.text))methods.set(n.name.text,n);ts.forEachChild(n,visit);}visit(ast);assert.equal(methods.size,2);
class HostGet{constructor(input){this.input=input;this.host=true;}};
let conversions=0;
const client={send:async command=>{assert.equal(command.host,true);conversions++;return {Item:{verified:true}};}},sdk={GetCommand:HostGet};
const rootApi={matches:(m,i)=>i.action==='SETTLE_PAYOUT_BY_OFFSET'||i.view==='settlement-corrections',route:async(ctx,p,m,i)=>{const r=await ctx.db.send({constructor:{name:'GetCommand'},input:{TableName:'synthetic'}});return {r,principal:p,input:i};},read:async(db)=>db.send({constructor:{name:'GetCommand'},input:{TableName:'synthetic'}})};
(async()=>{for(const n of methods.values()){
 const box={module:{exports:{}},process:{env:{LAMBDA_TASK_ROOT:'/synthetic'}},require:()=>rootApi,require_dist_cjs60:()=>sdk};vm.createContext(box);vm.runInContext(helper.getText(ast)+'\n(function('+n.parameters.map(p=>p.name.getText(ast)).join(',')+')'+n.body.getText(ast)+')(null,module);',box);
 if(n.name.text.includes('merchant-payouts')){assert.equal(box.module.exports.matches('GET',{view:'settlement-corrections'}),true);const p={staff:{employeeId:'verified-staff'}};const r=await box.module.exports.route({db:client},p,'POST',{action:'SETTLE_PAYOUT_BY_OFFSET'});assert.equal(r.principal,p);}else await box.module.exports.read(client,{});
 }
 assert.equal(conversions,2);assert(s.includes('require("../../company-accounts.js").route({db:__correctionDb352(db)'));assert(!s.includes('require("../../company-accounts-281.js").route({db,table'));
 console.log('PASS: actual bundled merchant routing, owner account routing, company route, and SDK command bridges are connected. No AWS call.');
})().catch(e=>{console.error(e);process.exitCode=1;});
