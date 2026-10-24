const {test}=require('node:test'),assert=require('node:assert/strict');
const {route,project}=require('../order-exception-cases'),client=require('../order-exception-case-client');
test('finance operator may record own cash execution without gaining approval or old-case privileges',async()=>{
 const original=client.invoke;let calls=0;client.invoke=async(token,body)=>{assert.equal(token,'original-token');assert.equal(body.action,'EXECUTE_CUSTOMER_REFUND');calls++;return {success:true};};
 try{const actor={employeeId:'operator',scope:{allRegions:true}},permissions=new Set(['finance.read','finance.request']);
 const ctx={allowed:(_a,p)=>permissions.has(p),enrolled:true,recent:()=>{},claims:{},accessToken:'original-token',db:{send:async()=>{throw Error('Unexpected read');}}};
 const body={caseKey:'CUSTOMER_CASH_REVIEW',action:'EXECUTE_CUSTOMER_REFUND'};
 assert.equal((await route(ctx,actor,'POST','/staff/order-exceptions/actions',body)).success,true);
 await assert.rejects(route(ctx,actor,'POST','/staff/order-exceptions/actions',{...body,action:'APPROVE_CUSTOMER_REFUND'}),/PERMISSION_REQUIRED/);
 await assert.rejects(route(ctx,actor,'POST','/staff/order-exceptions/actions',{...body,caseKey:'RETURN#1'}),/PERMISSION_REQUIRED/);
 permissions.delete('finance.request');await assert.rejects(route(ctx,actor,'POST','/staff/order-exceptions/actions',body),/PERMISSION_REQUIRED/);assert.equal(calls,1);
 }finally{client.invoke=original;}
});
test('cash review projection keeps financial amounts and counterpart reports out of an operational-only view',()=>{
 const order={orderId:'order1',storeId:'branch1'},row={orderId:'order1',sk:'CUSTOMER_CASH_REVIEW',kind:'CUSTOMER_CASH_REVIEW_CASE',caseId:'case1',state:'REVIEW_REQUIRED',version:1,reports:[{reportedPaidIqd:8000}],refunds:{refunds:[{amountIqd:2000}]},refundApprovalGuards:{private:'not a presentation field'}};
 assert.equal(project(order,row,false).customerCash,null);const v=project(order,row,true);assert.equal(v.type,'CUSTOMER_CASH_REVIEW');assert.equal(v.customerCash.reports[0].reportedPaidIqd,8000);assert.equal('refundApprovalGuards'in v,false);
});
