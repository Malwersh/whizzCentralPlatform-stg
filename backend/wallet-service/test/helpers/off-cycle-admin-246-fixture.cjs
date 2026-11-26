'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./merchant-settlement-schedule-fixture.cjs');
const {proof}=require('./merchant-accrual-fixture.cjs');
const {createMerchantStatementsAdmin:create}=require('../../dist/merchantStatementsAdmin');
async function admin(){
 const s=fixture();await s.publish();const {f}=await proof();
 for(const [key,row]of s.rows){const table=key.split('|')[0];f.put(table,row);}
 const employeeId='11111111-1111-4111-8111-111111111111',clock=Date.parse('2026-10-23T00:00:00.000Z');
 f.put('staging-PlatformStaff',{pk:'EMPLOYEE#'+employeeId,sk:'PROFILE',employeeId,roles:['finance_operator','finance_approver'],status:'ACTIVE',version:1,scope:{allRegions:true},mfaRequired:true});
 const db={send:async c=>{if(c.constructor.name==='QueryCommand'){const q=c.input;return {Items:[...f.rows.entries()].filter(([key,r])=>key.startsWith(q.TableName+'|')&&r.pk===q.ExpressionAttributeValues[':pk']&&r.sk.startsWith(q.ExpressionAttributeValues[':prefix'])).map(([,r])=>structuredClone(r))};}const sdk=require('@aws-sdk/lib-dynamodb');return f.db.send(new sdk[c.constructor.name](c.input));}};
 const service=create({db,now:()=>clock,principal:{employeeId,authTime:clock/1000,mfaEnrolled:true}});return {f,db,service,employeeId};
}

module.exports={admin};
