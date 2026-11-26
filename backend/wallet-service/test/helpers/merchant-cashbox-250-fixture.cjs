'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture}=require('./merchant-settlement-batch-fixture.cjs');
const {createMerchantPayoutService:create,verifyMerchantPayoutJournal}=require('../../dist/merchantPayout');
const {quoteHash}=require('../../dist/deliveryQuoteRecord');
const {readMerchantAccrualEvidence}=require('../../dist/merchantSettlementPreview');
const {ledgerEffect}=require('../../dist/ledgerEffects');
async function setup(){
 const f=await fixture(),b=await f.service.create(await f.request()),owner=f.f.get('WhizzMerchants_Businesses',{businessId:'branch1'}).ownerId;
 const body={schemaVersion:1,kind:'MERCHANT_STATEMENT_APPROVAL',branchId:'branch1',batchId:b.header.batchId,batchDigest:b.header.batchDigest,status:'APPROVED_NOT_PAID',approvalPolicy:'SINGLE_ADMIN',approvedBy:'admin1',approvedAt:'2026-10-23T00:00:00.000Z',payoutAuthorized:false,walletMutationPerformed:false,retentionClass:'FINANCIAL_SETTLEMENT'};
 f.f.put('staging-MerchantPlatform',{pk:'MERCHANT_SETTLEMENT#branch1',sk:'APPROVAL#'+b.header.batchId,...body,digest:quoteHash(body)});
 let role='OWNER',clock=Date.parse('2026-10-23T00:00:00.000Z'),sent=[],lose=false,hook=null;
 const db={send:async c=>{if(hook)await hook(c);const result=await f.db.send(c);if(lose&&c.constructor.name==='TransactWriteCommand'){lose=false;throw Error('response lost after commit');}return result;}};
 f.f.put('staging-MerchantPlatform',{pk:'MERCHANT_CASHBOXES#GLOBAL',sk:'BOX#CASH-DESK-01',kind:'MERCHANT_CASHBOX',code:'CASH-DESK-01',name:'صندوق الاختبار',custodian:'أمين الاختبار',location:'بغداد',status:'ACTIVE',version:1});
 require('./cashbox-accounting-251-seed.cjs').seed(f.f);
 const service=create({db,now:()=>clock,authorize:async(branch,action)=>{if(branch!=='branch1'||role==='OWNER'&&['STAFF','APPROVE'].includes(action)||role==='STAFF'&&action==='OWNER')throw Error('FORBIDDEN');return {actorId:role==='OWNER'?owner:'admin1',owner:role==='OWNER',guards:[]};},readBatch:()=>f.service.read({branchId:'branch1',batchId:b.header.batchId}),listBatches:()=>f.service.list({branchId:'branch1',limit:20}),otp:{secret:async()=> 'synthetic-test-only-secret',send:async(phone,code)=>sent.push({phone,code})}});
 const request=(extra={})=>({action:'REQUEST_PAYOUT',branchId:'branch1',batchId:b.header.batchId,batchDigest:b.header.batchDigest,method:'CASH',requestId:randomUUID(),...extra});
 const act=async(row,action,extra={})=>service.act({action,branchId:'branch1',payoutId:row.payoutId,version:row.version,requestId:randomUUID(),...extra});
 return {...f,b,owner,service,request,act,sent,role:r=>role=r,clock:n=>clock+=n,lose:()=>lose=true,hook:h=>hook=h};
}

module.exports={setup};
