'use strict';
const {createMerchantPayoutApi}=require('./settlement-runtime');
const actions=new Set(['REQUEST_CORRECTION_PAYOUT','SETTLE_PAYOUT_BY_OFFSET','REQUEST_CASH_OPERATION','POST_CASH_OPERATION','CANCEL_CASH_OPERATION','CREATE_CASHBOX','UPDATE_CASHBOX','REQUEST_PAYOUT','START_PAYOUT_DESTINATION','VERIFY_PAYOUT_DESTINATION','APPROVE_PAYOUT','BEGIN_PAYOUT','RECORD_PAYOUT_EXECUTION','ACK_PAYOUT_RECEIPT','RECONCILE_PAYOUT','CANCEL_PAYOUT','REPORT_PAYOUT_PROBLEM','REOPEN_PAYOUT_RECEIPT','ACK_PAYOUT_NOT_RECEIVED','RESOLVE_PAYOUT_NOT_PAID']);
const views=new Set(['cash-account','cash-operations','cash-ledger','cash-counts','cash-custodians','cashboxes','cashbox-register','payouts','payout','payout-statements','payout-statement','merchant-account']);
function matches(method,input){if(require('./merchant-corrections').matches(method,input))return true;return method==='GET'?views.has(input?.view):actions.has(input?.action);}
async function route(ctx,principal,method,input){
 if(require('./merchant-corrections').matches(method,input))return require('./merchant-corrections').route({...ctx,caseDb:ctx.db,db:require('./settlement-orders').projectEvidenceDb(ctx.db)},principal,method,input);
 const service=createMerchantPayoutApi({db:require('./settlement-orders').projectEvidenceDb(ctx.db),...principal,readAccount:body=>require('./merchant-account').read(ctx.db,body,!!principal.owner),otp:ctx.payoutOtp||require('./payout-otp-provider')});
 if(method==='POST')return service.act(input);
 const {view,...body}=input;
 if(view==='cash-account')return service.cashAccount(body);
 if(view==='cash-custodians')return service.cashCustodians(body);
 if(['cash-operations','cash-ledger','cash-counts'].includes(view))return service.cashList({...body,view});
 if(view==='cashboxes')return service.cashboxes(body);
 if(view==='cashbox-register')return service.cashboxRegister(body);
 if(view==='merchant-account')return service.account(body);
 if(view==='payout-statement')return service.statement(body);
 if(view==='payouts')return service.list(body);
 if(view==='payout')return service.details(body);
 if(view==='payout-statements'&&Object.keys(body).every(k=>['branchId','cursor'].includes(k)))return service.statements(body.branchId,body.cursor);
 throw Object.assign(Error('PAYOUT_INVALID_REQUEST'),{code:'PAYOUT_INVALID_REQUEST'});
}
module.exports={matches,route};
