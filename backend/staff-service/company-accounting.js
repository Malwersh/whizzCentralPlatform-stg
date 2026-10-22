'use strict';
const {createHash}=require('crypto');
const {chart}=require('./company-chart');
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).filter(k=>v[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
const add=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))fail('COMPANY_MONEY_OVERFLOW');return n;};
function minor(v){if(v&&typeof v==='object'){if(v.currency!=='IQD'||v.scale!==1000||v.moneySchemaVersion!==1||!Number.isSafeInteger(v.minorAmount))fail('COMPANY_MONEY_INVALID');return v.minorAmount;}if(!Number.isSafeInteger(v))fail('COMPANY_MONEY_INVALID');const n=v*1000;if(!Number.isSafeInteger(n))fail('COMPANY_MONEY_INVALID');return n;}
function date(s){if(typeof s!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(s)||(!Number.isFinite(Date.parse(s+'T00:00:00Z'))||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s))fail('COMPANY_PERIOD_INVALID');return s;}
function bounds(q,now=Date.now()){const from=date(q.from),through=date(q.through);const start=Date.parse(from+'T00:00:00+03:00'),end=Date.parse(through+'T00:00:00+03:00')+86400000;if(start>=end||end-start>366*86400000||start>now)fail('COMPANY_PERIOD_INVALID');return{from,through,start,end,timeZone:'Asia/Baghdad',countryLabel:'العراق'};}
function normalize(lines){if(!Array.isArray(lines)||lines.length>100)fail('COMPANY_JOURNAL_INVALID');return lines.map(l=>{if(!l||typeof l.account!=='string'||!['DEBIT','CREDIT'].includes(l.side))fail('COMPANY_JOURNAL_INVALID');const n=Object.hasOwn(l,'amountMinor')?l.amountMinor:minor(Object.hasOwn(l,'amountIqd')?l.amountIqd:l.amount);if(!Number.isSafeInteger(n)||n<0)fail('COMPANY_MONEY_INVALID');return{account:l.account,side:l.side,amountMinor:n,...(typeof l.code==='string'?{dimension:l.code}:{}),...(typeof l.dimension==='string'?{dimension:l.dimension}: {})};}).filter(l=>l.amountMinor!==0);}
function totals(lines){let debit=0,credit=0;for(const l of lines){if(l.side==='DEBIT')debit=add(debit,l.amountMinor);else credit=add(credit,l.amountMinor);}if(debit!==credit)fail('COMPANY_JOURNAL_UNBALANCED');return{debitMinor:debit,creditMinor:credit};}
function extract(platform,holds,documents){const journals=[],issues=[],seen=new Map();
 const issue=(code,r)=>issues.push({code,source:r.pk||r.orderId||r.journalId||'غير محدد',kind:r.kind||'UNKNOWN'});
 function push(r,lines,source,id,at){try{if(typeof id!=='string'||id.endsWith(':undefined'))fail('COMPANY_SOURCE_ID_INVALID');const ls=normalize(lines),t=totals(ls);if(!ls.length)return;if(!Number.isFinite(Date.parse(at)))fail('COMPANY_SOURCE_DATE_INVALID');const j={id,source,kind:r.kind,at,orderId:r.orderId||null,branchId:r.branchId||null,reference:r.reference||r.externalReference||r.voucherNumber||r.documentNumber||id,reason:r.reason||null,lines:ls,...t};const signature=hash({at,lines:ls});if(seen.has(id)){if(seen.get(id)!==signature)issue('DUPLICATE_SOURCE_CONFLICT',r);return;}seen.set(id,signature);for(const l of ls)if(!chart[l.account])issue('UNCLASSIFIED_ACCOUNT:'+l.account,r);journals.push(j);}catch(e){issue(e.code||'SOURCE_INVALID',r);}}
 for(const r of platform){
  if(r.kind==='FULL_CASH_ACCOUNTING_JOURNAL'&&r.status==='POSTED')push(r,r.lines,'ORDER','ORDER:'+r.orderId,r.createdAt);
  else if(r.kind==='MERCHANT_PAYOUT_PAID_JOURNAL'&&r.status==='PAID')push(r,r.lines,'PAYOUT','PAYOUT:'+r.payoutId,r.paidAt);
  else if(r.kind==='CASHBOX_LEDGER_ENTRY')push(r,r.lines,'CASHBOX','CASHBOX:'+r.journalId,r.at);
  else if(r.kind&&r.kind.includes('JOURNAL')&&r.lines?.length)issue('UNSUPPORTED_PLATFORM_JOURNAL',r);
 }
 for(const r of holds){
  if(r.kind==='CASH_ADJUDICATION_ACCOUNTING_JOURNAL'&&r.status==='POSTED')push(r,r.lines,'ADJUDICATION','ADJUDICATION:'+r.decisionId,r.createdAt);
  else if(r.kind==='ORDER_EXCEPTION_ENTITLEMENTS_JOURNAL'&&r.state==='POSTED')push(r,r.accountingLines,'EXCEPTION','EXCEPTION:'+r.operationId,r.createdAt);
  else if(r.kind==='ORDER_EXCEPTION_GUARANTEE_JOURNAL'&&r.state==='POSTED'&&r.captureIqd){push(r,[{account:'DRIVER_PREPAID_COLLATERAL',side:'DEBIT',amount:r.captureIqd},{account:'GUARANTEE_CLEARING',side:'CREDIT',amount:r.captureIqd}],'GUARANTEE','GUARANTEE:'+r.operationId,r.createdAt);}
  else if(r.kind==='COD_COMPLETION_JOURNAL'&&r.outcome==='COMPLETED'){
   try{const a=r.allocation;const H=minor(a.driverWalletHold),M=minor(a.merchantPayable),A=minor(a.driverWalletCreditTotal),P=minor(a.platformNetContribution);if(H!==add(add(M,A),P))fail('LEGACY_ALLOCATION_REQUIRES_REVIEW');push(r,[{account:'DRIVER_PREPAID_COLLATERAL',side:'DEBIT',amountMinor:H},{account:'MERCHANT_PAYABLE',side:'CREDIT',amountMinor:M},{account:'DRIVER_WALLET_PAYABLE',side:'CREDIT',amountMinor:A},{account:P>=0?'LEGACY_NET_REVENUE':'LEGACY_NET_EXPENSE',side:P>=0?'CREDIT':'DEBIT',amountMinor:Math.abs(P)}],'LEGACY','LEGACY:'+r.operationId,r.createdAt);}catch(e){issue(e.code||'LEGACY_ALLOCATION_REQUIRES_REVIEW',r);}
  }
 }
 for(const r of documents)if(r.kind==='COMPANY_ACCOUNTING_DOCUMENT'&&r.status==='POSTED')push(r,r.lines,'COMPANY','COMPANY:'+r.documentId,r.postedAt);
 return{journals:journals.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id)),issues};
}
function report(data,q,now=Date.now()){
 const period=bounds(q,now),asOf=new Date(now).toISOString(),{journals,issues}=extract(data.platform,data.holds,data.documents);
 const trial=new Map(),periodJournals=[],daily=new Map();let revenue=0,expense=0;
 for(const j of journals){const at=Date.parse(j.at);if(at>now||at>=period.end)continue;const within=at>=period.start;if(within)periodJournals.push(j);
  for(const l of j.lines){const id=l.account+(l.dimension?'@'+l.dimension:''),def=chart[l.account]||{label:l.account,type:'UNCLASSIFIED'};let a=trial.get(id);if(!a){a={id,account:l.account,dimension:l.dimension||null,label:def.label,type:def.type,openingMinor:0,debitMinor:0,creditMinor:0,closingMinor:0};trial.set(id,a);}const signed=l.side==='DEBIT'?l.amountMinor:-l.amountMinor;a.closingMinor=add(a.closingMinor,signed);if(!within)a.openingMinor=add(a.openingMinor,signed);else{a[l.side==='DEBIT'?'debitMinor':'creditMinor']=add(a[l.side==='DEBIT'?'debitMinor':'creditMinor'],l.amountMinor);if(def.type==='REVENUE')revenue=add(revenue,-signed);if(def.type==='EXPENSE')expense=add(expense,signed);}}
  if(within){const day=new Date(at+10800000).toISOString().slice(0,10),r=daily.get(day)||{day,revenueMinor:0,expenseMinor:0,netMinor:0};for(const l of j.lines){const t=chart[l.account]?.type,n=l.side==='DEBIT'?l.amountMinor:-l.amountMinor;if(t==='REVENUE')r.revenueMinor=add(r.revenueMinor,-n);if(t==='EXPENSE')r.expenseMinor=add(r.expenseMinor,n);}r.netMinor=add(r.revenueMinor,-r.expenseMinor);daily.set(day,r);}
 }
 for(const o of data.holds.filter(r=>r.kind==='FULL_CASH_COMPLETION_JOURNAL'&&r.outcome==='COMPLETED')){const journal=data.platform.find(j=>j.kind==='FULL_CASH_ACCOUNTING_JOURNAL'&&j.orderId===o.orderId&&j.status==='POSTED');if(!journal||journal.operationId!==o.operationId||journal.postingDigest!==o.journalDigest)issues.push({code:'ORDER_JOURNAL_PROOF_MISSING',source:o.orderId});}
 const accounts=[...trial.values()].sort((a,b)=>a.type.localeCompare(b.type)||a.id.localeCompare(b.id));
 const allOutcomes=data.holds.filter(r=>r.sk==='FINANCIAL_OUTCOME'&&Date.parse(r.createdAt)<=now),outcomes=allOutcomes.filter(r=>Date.parse(r.createdAt)>=period.start&&Date.parse(r.createdAt)<period.end);
 const stats={completed:0,returned:0,cancelled:0,customerTotalMinor:0,collectedMinor:0};const orderSet=new Set();for(const r of outcomes){if(orderSet.has(r.orderId)){issues.push({code:'DUPLICATE_ORDER_OUTCOME',source:r.orderId});continue;}orderSet.add(r.orderId);const status={COMPLETED:'completed',RETURNED:'returned',CANCELLED:'cancelled'}[r.outcome];if(status)stats[status]++;try{if(r.outcome==='COMPLETED'){stats.customerTotalMinor=add(stats.customerTotalMinor,minor(r.allocation.customerTotal));if(r.receipt?.cashCollectedAmount!=null)stats.collectedMinor=add(stats.collectedMinor,minor(r.receipt.cashCollectedAmount));}}catch(_){issues.push({code:'ORDER_STATISTICS_UNVERIFIED',source:r.orderId});}}
 const current={observedAt:asOf,cashboxes:[],wallets:[],merchantPayables:[],customerReceivables:[],refundReservations:[],unsettledRefunds:[]};
 for(const r of data.platform)if(r.kind==='CASHBOX_BALANCE')current.cashboxes.push({code:r.code,amountMinor:minor(r.balanceIqd),pendingDifference:!!r.pendingCountId,updatedAt:r.updatedAt});
 for(const w of data.wallets)if(w.sk==='META')current.wallets.push({walletId:w.walletId,ownerType:w.ownerType,availableMinor:minor(w.availableBalance),lockedMinor:minor(w.lockedBalance),updatedAt:w.updatedAt||null});
 for(const r of data.holds){if(['MERCHANT_ORDER_PAYABLE','MERCHANT_EXCEPTION_PAYABLE'].includes(r.kind)&&r.status==='LOCKED_PENDING_SETTLEMENT')current.merchantPayables.push({orderId:r.orderId,branchId:r.branchId,amountMinor:minor(r.returnFinancialVersion?r.returnRemainingAmount:r.amount)});
  if(r.kind==='CUSTOMER_CASH_RECEIVABLE'&&r.status==='OPEN')current.customerReceivables.push({orderId:r.orderId,amountMinor:minor(r.amountIqd)});
  if(r.kind==='CUSTOMER_CASH_REVIEW_CASE')for(const f of r.refunds?.refunds||[])if(['APPROVED','EXECUTED','ACKNOWLEDGED'].includes(f.status))current.refundReservations.push({orderId:r.orderId,reference:f.voucherNumber,status:f.status,amountMinor:minor(f.amountIqd)});
  if(r.kind==='DRIVER_UNSETTLED_CASH_REFUND')current.unsettledRefunds.push({orderId:r.orderId,reference:r.voucherNumber,amountMinor:minor(r.amountIqd),at:r.at});
 }
 for(const key of ['cashboxes','wallets','merchantPayables','customerReceivables','refundReservations','unsettledRefunds'])current[key].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 const debit=accounts.reduce((n,a)=>add(n,a.debitMinor),0),credit=accounts.reduce((n,a)=>add(n,a.creditMinor),0);
 const orders=outcomes.map(r=>{const related=periodJournals.filter(j=>j.orderId===r.orderId);let rev=0,exp=0;for(const j of related)for(const l of j.lines){const sign=l.side==='CREDIT'?l.amountMinor:-l.amountMinor;if(chart[l.account]?.type==='REVENUE')rev=add(rev,sign);if(chart[l.account]?.type==='EXPENSE')exp=add(exp,-sign);}return{orderId:r.orderId,branchId:r.branchId,at:r.createdAt,outcome:r.outcome,revenueMinor:rev,expenseMinor:exp,netMinor:add(rev,-exp)};});
 const result={schemaVersion:1,period,asOf,currency:'IQD',scale:1000,stats,summary:{revenueMinor:revenue,expenseMinor:expense,netMinor:add(revenue,-expense),journalCount:periodJournals.length,debitMinor:debit,creditMinor:credit},accounts,journals:periodJournals,daily:[...daily.values()].sort((a,b)=>a.day.localeCompare(b.day)),orders,current,issues,coverage:{status:issues.length?'REVIEW_REQUIRED':'SUPPORTED_SOURCES_COMPLETE',legacyNetOnly:periodJournals.filter(j=>j.source==='LEGACY').length,readConsistency:'PER_ITEM_NOT_ATOMIC',scope:'POSTED_SUPPORTED_JOURNALS',statementIsPeriodLock:false}};
 result.sourceDigest=hash({journals:journals.filter(j=>Date.parse(j.at)<=now&&Date.parse(j.at)<period.end),period:{from:period.from,through:period.through},outcomes:allOutcomes.map(r=>({orderId:r.orderId,operationId:r.operationId,outcome:r.outcome})).sort((a,b)=>a.orderId.localeCompare(b.orderId)),current:{...current,observedAt:undefined}});return result;
}
module.exports={report,extract,bounds,normalize,totals,minor,add,hash,canonical,fail};
