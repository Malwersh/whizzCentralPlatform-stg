'use strict';
const {ScanCommand,GetCommand,QueryCommand,BatchGetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('crypto');
const E=require('./company-accounting'),{chart,expenseAccounts}=require('./company-chart');
const PATH='/staff/company-accounts';
const fields=['pk','sk','kind','status','state','lines','accountingLines','createdAt','paidAt','at','postedAt','operationId','journalId','orderId','branchId','payoutId','decisionId','reference','externalReference','voucherNumber','documentNumber','documentId','reason','allocation','outcome','receipt','captureIqd','code','balanceIqd','pendingCountId','updatedAt','walletId','ownerType','availableBalance','lockedBalance','amount','amountIqd','returnFinancialVersion','returnRemainingAmount','refunds','requestedBy','version','requestDigest','accountId','name','accountType','reversedDocumentId','postingDigest','journalDigest','amountMinor','counterparty','type','category'];
const tables={platform:'staging-MerchantPlatform',holds:'staging-Holds',wallets:'staging-Wallets'};
const id=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const text=(v,min=3,max=500)=>typeof v==='string'&&v.trim().length>=min&&v.length<=max;
const get=async(c,key)=>(await c.db.send(new GetCommand({TableName:c.table,Key:key,ConsistentRead:true}))).Item;
const put=(c,row,old)=>({Put:{TableName:c.table,Item:row,...(old?{ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':old.version,':s':old.status}}:{ConditionExpression:'attribute_not_exists(pk)'})}});
function access(c,a,p){if(a.status!=='ACTIVE'||!c.allowed(a,p))E.fail('PERMISSION_REQUIRED',403);if(a.scope?.allRegions!==true)E.fail('GLOBAL_SCOPE_REQUIRED',403);}
function strict(v,keys){if(!v||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))E.fail('COMPANY_INPUT_INVALID');}
async function scan(c,table,filter){let rows=[],cursor,pages=0;do{const names=Object.fromEntries(fields.map((f,i)=>['#f'+i,f]));const r=await c.db.send(new ScanCommand({TableName:table,ConsistentRead:true,ProjectionExpression:fields.map((_,i)=>'#f'+i).join(','),ExpressionAttributeNames:names,Limit:250,ExclusiveStartKey:cursor,...(filter?{FilterExpression:'#f2 = :document',ExpressionAttributeValues:{':document':'COMPANY_ACCOUNTING_DOCUMENT'}}:{})}));rows.push(...(r.Items||[]));cursor=r.LastEvaluatedKey;if(++pages>200||rows.length>25000||c.deadline&&Date.now()>c.deadline)E.fail('COMPANY_REPORT_TOO_LARGE',503);}while(cursor);return rows;}
async function data(c){const [platform,holds,wallets,documents]=await Promise.all([scan(c,tables.platform),scan(c,tables.holds),scan(c,tables.wallets),scan(c,c.table,true)]);return{platform,holds,wallets,documents};}
async function list(c,pk){let items=[],cursor,pages=0;do{const r=await c.db.send(new QueryCommand({TableName:c.table,KeyConditionExpression:'pk = :pk',ExpressionAttributeValues:{':pk':pk},ExclusiveStartKey:cursor,ConsistentRead:true,Limit:100}));items.push(...(r.Items||[]));cursor=r.LastEvaluatedKey;if(++pages>100)E.fail('COMPANY_LIST_INCOMPLETE',503);}while(cursor);return items;}
async function enrich(c,r){
 const ids=[...new Set([...r.orders.map(o=>o.orderId),...r.journals.map(j=>j.orderId)].filter(Boolean))],directory=new Map();
 for(let i=0;i<ids.length;i+=100){let request={WizzOrders:{Keys:ids.slice(i,i+100).map(id=>({PK:'ORDER#'+id,SK:'META'})),ConsistentRead:true,ProjectionExpression:'PK, SK, orderId, orderNumber, storeName, restaurantName, businessName'}};
  for(let attempt=0;Object.keys(request).length;attempt++){if(attempt>=4)E.fail('COMPANY_ORDER_DIRECTORY_INCOMPLETE',503);const v=await c.db.send(new BatchGetCommand({RequestItems:request}));for(const o of v.Responses?.WizzOrders||[])directory.set(o.orderId||o.PK.slice(6),o);request=v.UnprocessedKeys||{};}
 }
 for(const o of r.orders){const v=directory.get(o.orderId);o.orderNumber=v?.orderNumber||null;o.branchName=v?.storeName||v?.restaurantName||v?.businessName||null;}
 for(const j of r.journals)if(j.orderId){const v=directory.get(j.orderId);j.orderNumber=v?.orderNumber||null;if(j.reference===j.id&&v?.orderNumber)j.reference=v.orderNumber;}
 return r;
}
function parseAmount(v){if(typeof v!=='string'||!/^\d{1,12}(\.\d{1,3})?$/.test(v))E.fail('COMPANY_MONEY_INVALID');const [a,b='']=v.split('.');const n=Number(a)*1000+Number(b.padEnd(3,'0'));if(!Number.isSafeInteger(n)||n<=0||n>1e12)E.fail('COMPANY_MONEY_INVALID');return n;}
async function makeDocument(c,a,v,now){strict(v,['action','requestId','type','amount','expenseAccount','externalAccountId','counterparty','reference','reason','reversedDocumentId']);if(!id(v.requestId)||!text(v.reference,3,200)||!text(v.reason,5,1000)||!text(v.counterparty,2,120))E.fail('COMPANY_INPUT_INVALID');const n=parseAmount(v.amount);let lines=[],accountPin=null,original=null;
 const line=(account,side,dimension)=>({account,side,amountMinor:n,...(dimension?{dimension}:{})});
 if(v.type==='EXPENSE_ACCRUAL'){if(!expenseAccounts.includes(v.expenseAccount))E.fail('COMPANY_INPUT_INVALID');lines=[line(v.expenseAccount,'DEBIT'),line('COMPANY_PAYABLE','CREDIT',v.counterparty.trim())];}
 else if(v.type==='OPENING_RECEIVABLE')lines=[line('COMPANY_RECEIVABLE','DEBIT',v.counterparty.trim()),line('OPENING_EQUITY','CREDIT')];
 else if(v.type==='OPENING_PAYABLE')lines=[line('OPENING_EQUITY','DEBIT'),line('COMPANY_PAYABLE','CREDIT',v.counterparty.trim())];
 else if(v.type==='REVENUE_ACCRUAL')lines=[line('COMPANY_RECEIVABLE','DEBIT',v.counterparty.trim()),line('PLATFORM_OTHER_REVENUE','CREDIT')];
 else if(['SETTLE_PAYABLE','COLLECT_RECEIVABLE','OPENING'].includes(v.type)){
  if(!id(v.externalAccountId))E.fail('COMPANY_EXTERNAL_ACCOUNT_REQUIRED');const account=await get(c,{pk:'COMPANY_ACCOUNTS',sk:v.externalAccountId});if(!account||account.status!=='ACTIVE')E.fail('COMPANY_EXTERNAL_ACCOUNT_REQUIRED');accountPin=account;const bank=account.accountType==='BANK'?'COMPANY_BANK':'COMPANY_ZAIN_CASH';
  lines=v.type==='SETTLE_PAYABLE'?[line('COMPANY_PAYABLE','DEBIT',v.counterparty.trim()),line(bank,'CREDIT',account.accountId)]:v.type==='COLLECT_RECEIVABLE'?[line(bank,'DEBIT',account.accountId),line('COMPANY_RECEIVABLE','CREDIT',v.counterparty.trim())]:[line(bank,'DEBIT',account.accountId),line('OPENING_EQUITY','CREDIT')];
 }else if(v.type==='REVERSAL'){
  if(!id(v.reversedDocumentId))E.fail('COMPANY_INPUT_INVALID');original=await get(c,{pk:'COMPANY_DOCUMENT#'+v.reversedDocumentId,sk:'META'});if(!original||original.status!=='POSTED'||original.type==='REVERSAL'||E.totals(original.lines).debitMinor!==n)E.fail('COMPANY_REVERSAL_INVALID');lines=original.lines.map(l=>({...l,side:l.side==='DEBIT'?'CREDIT':'DEBIT'}));
 }else E.fail('COMPANY_INPUT_INVALID');
 const requestDigest=E.hash(v),documentId=v.requestId;return{pk:'COMPANY_DOCUMENT#'+documentId,sk:'META',kind:'COMPANY_ACCOUNTING_DOCUMENT',retentionClass:'FINANCIAL_SETTLEMENT',documentId,documentNumber:'CA-'+now.slice(0,10).replace(/-/g,'')+'-'+documentId.replace(/-/g,'').slice(0,12).toUpperCase(),type:v.type,status:'PENDING_APPROVAL',version:1,requestDigest,requestedBy:a.employeeId,createdAt:now,amountMinor:n,reference:v.reference.trim(),reason:v.reason.trim(),counterparty:v.counterparty.trim(),lines,accountPin,reversedDocumentId:original?.documentId||null,originalDigest:original?E.hash(original):null};}
async function route(c,a,method,path,v={}){access(c,a,'finance.read');const now=new Date(c.now?c.now():Date.now()).toISOString();
 if(method==='GET'){
  const q=c.query||{};strict(q,['from','through','view','statementId']);
  if(q.view==='catalog')return{chart:Object.values(chart),expenseAccounts,externalAccounts:await list(c,'COMPANY_ACCOUNTS'),documents:(await scan(c,c.table,true)).map(r=>({documentId:r.documentId,documentNumber:r.documentNumber,type:r.type,status:r.status,amountMinor:r.amountMinor,reference:r.reference,reason:r.reason,counterparty:r.counterparty,requestedBy:r.requestedBy,createdAt:r.createdAt,postedAt:r.postedAt,lines:r.lines})),statements:(await list(c,'COMPANY_STATEMENTS')).map(r=>({statementId:r.statementId,reference:r.reference,from:r.from,through:r.through,createdAt:r.createdAt,sourceDigest:r.sourceDigest}))};
  if(q.view==='statement'){if(!id(q.statementId))E.fail('COMPANY_STATEMENT_INVALID');const header=await get(c,{pk:'COMPANY_STATEMENT#'+q.statementId,sk:'META'});if(!header)E.fail('COMPANY_STATEMENT_NOT_FOUND',404);const chunks=await list(c,'COMPANY_STATEMENT#'+q.statementId);const raw=chunks.filter(r=>r.sk.startsWith('PART#')).sort((a,b)=>a.sk.localeCompare(b.sk)).map(r=>r.content).join('');if(E.hash(raw)!==header.contentDigest)E.fail('COMPANY_STATEMENT_PROOF_INVALID',409);return{report:JSON.parse(raw),statement:{statementId:header.statementId,reference:header.reference,createdAt:header.createdAt,sourceDigest:header.sourceDigest}};}
  E.bounds(q,c.now?c.now():Date.now());return{report:await enrich(c,E.report(await data(c),q,c.now?c.now():Date.now()))};
 }
 if(method!=='POST')E.fail('METHOD_NOT_ALLOWED',405);
 if(!['APPROVE_DOCUMENT','REJECT_DOCUMENT'].includes(v.action))access(c,a,'finance.request');c.recent(c.claims);if(a.mfaRequired&&!c.enrolled)E.fail('ENROLLMENT_REQUIRED',403);
 if(v.action==='REGISTER_ACCOUNT'){strict(v,['action','requestId','name','accountType','reference']);if(!id(v.requestId)||!text(v.name,2,120)||!text(v.reference,3,200)||!['BANK','ZAIN_CASH'].includes(v.accountType))E.fail('COMPANY_INPUT_INVALID');const row={pk:'COMPANY_ACCOUNTS',sk:v.requestId,accountId:v.requestId,name:v.name.trim(),accountType:v.accountType,status:'ACTIVE',version:1,reference:v.reference.trim(),createdAt:now,createdBy:a.employeeId};const old=await get(c,{pk:row.pk,sk:row.sk});if(old){if(old.name!==row.name||old.reference!==row.reference||old.accountType!==row.accountType)E.fail('COMPANY_REQUEST_CONFLICT',409);return{account:old,replayed:true};}await c.db.send(new TransactWriteCommand({TransactItems:[c.guard(a),put(c,row),c.audit(a.employeeId,'COMPANY_ACCOUNT_REGISTERED',null,row,v.requestId)]}));return{account:row};}
 if(v.action==='SAVE_STATEMENT'){strict(v,['action','requestId','from','through','sourceDigest']);if(!id(v.requestId)||! /^[a-f0-9]{64}$/.test(v.sourceDigest||''))E.fail('COMPANY_INPUT_INVALID');const prior=await get(c,{pk:'COMPANY_STATEMENT#'+v.requestId,sk:'META'});if(prior){if(prior.from!==v.from||prior.through!==v.through||prior.sourceDigest!==v.sourceDigest)E.fail('COMPANY_REQUEST_CONFLICT',409);return{statement:prior,replayed:true};}const r=await enrich(c,E.report(await data(c),v,c.now?c.now():Date.now()));if(r.sourceDigest!==v.sourceDigest)E.fail('COMPANY_REPORT_CHANGED',409);if(r.issues.length)E.fail('COMPANY_REPORT_REVIEW_REQUIRED',409);const raw=JSON.stringify(r);if(Buffer.byteLength(raw)>2500000)E.fail('COMPANY_REPORT_TOO_LARGE',503);const chars=Array.from(raw),chunks=[];for(let i=0;i<chars.length;i+=40000)chunks.push(chars.slice(i,i+40000).join(''));const row={pk:'COMPANY_STATEMENT#'+v.requestId,sk:'META',kind:'COMPANY_STATEMENT',retentionClass:'FINANCIAL_SETTLEMENT',statementId:v.requestId,reference:'CS-'+now.slice(0,10).replace(/-/g,'')+'-'+v.requestId.replace(/-/g,'').slice(0,12).toUpperCase(),from:v.from,through:v.through,sourceDigest:r.sourceDigest,contentDigest:E.hash(raw),createdAt:now,createdBy:a.employeeId};await c.db.send(new TransactWriteCommand({TransactItems:[c.guard(a),put(c,row),put(c,{...row,pk:'COMPANY_STATEMENTS',sk:now+'#'+v.requestId}),...chunks.map((content,i)=>put(c,{pk:row.pk,sk:'PART#'+String(i).padStart(4,'0'),content})),c.audit(a.employeeId,'COMPANY_STATEMENT_SAVED',null,{reference:row.reference,sourceDigest:row.sourceDigest},v.requestId)]}));return{statement:row};}
 if(v.action==='PROPOSE_DOCUMENT'){
  const row=await makeDocument(c,a,v,now),old=await get(c,{pk:row.pk,sk:row.sk});if(old){if(old.requestDigest!==row.requestDigest||old.requestedBy!==a.employeeId)E.fail('COMPANY_REQUEST_CONFLICT',409);return{document:old,replayed:true};}await c.db.send(new TransactWriteCommand({TransactItems:[c.guard(a),put(c,row),c.audit(a.employeeId,'COMPANY_DOCUMENT_PROPOSED',null,row,row.documentId)]}));return{document:row};
 }
 if(['APPROVE_DOCUMENT','REJECT_DOCUMENT'].includes(v.action)){
  strict(v,['action','documentId','reason']);access(c,a,'finance.approve');if(!id(v.documentId)||!text(v.reason,5,1000))E.fail('COMPANY_INPUT_INVALID');const row=await get(c,{pk:'COMPANY_DOCUMENT#'+v.documentId,sk:'META'});if(!row)E.fail('COMPANY_DOCUMENT_NOT_FOUND',404);if(row.status!=='PENDING_APPROVAL'){if(row.status==='POSTED'&&v.action==='APPROVE_DOCUMENT')return{document:row,replayed:true};E.fail('COMPANY_DOCUMENT_CHANGED',409);}
  // Same independent approval rule as the existing staging operator workflow.
  if(row.requestedBy===a.employeeId&&!require('./write-workflow').operator(a))E.fail('SELF_APPROVAL_FORBIDDEN',403);
  if(!Number.isSafeInteger(a.approvalLimit)||a.approvalLimit*1000<row.amountMinor)E.fail('EXCEPTION_APPROVAL_LIMIT',403);
  const requester=await c.employee(row.requestedBy);access(c,requester||{},'finance.request');
  const next={...row,status:v.action==='APPROVE_DOCUMENT'?'POSTED':'REJECTED',version:row.version+1,reviewReason:v.reason.trim(),reviewedBy:a.employeeId,reviewedAt:now,...(v.action==='APPROVE_DOCUMENT'?{postedAt:now}:{})};const ops=[c.guard(a),...(requester.employeeId!==a.employeeId?[c.guard(requester)]:[]),put(c,next,row),c.audit(a.employeeId,'COMPANY_'+next.status,{documentId:row.documentId,status:row.status},{documentId:row.documentId,status:next.status},randomUUID())];
  if(next.status==='POSTED'){
   E.totals(row.lines);
   if(row.type==='EXPENSE_ACCRUAL'){const sources=await scan(c,tables.platform);if(sources.some(s=>s.kind==='CASHBOX_LEDGER_ENTRY'&&s.category==='EXPENSE'&&String(s.reference||'').trim().toUpperCase()===row.reference.toUpperCase()))E.fail('COMPANY_REFERENCE_ALREADY_IN_CASHBOOK',409);}
   if(row.accountPin){const account=await get(c,{pk:'COMPANY_ACCOUNTS',sk:row.accountPin.accountId});if(!account||E.hash(account)!==E.hash(row.accountPin))E.fail('COMPANY_ACCOUNT_CHANGED',409);ops.push({ConditionCheck:{TableName:c.table,Key:{pk:account.pk,sk:account.sk},ConditionExpression:'#v=:v AND #s=:s',ExpressionAttributeNames:{'#v':'version','#s':'status'},ExpressionAttributeValues:{':v':account.version,':s':'ACTIVE'}}});}
   // Independent company-document subledger: prevents settling a debt or
   // spending a registered external-account balance twice under concurrency.
   for(const line of row.lines){
    if(!['COMPANY_PAYABLE','COMPANY_RECEIVABLE','COMPANY_BANK','COMPANY_ZAIN_CASH'].includes(line.account))continue;
    const k={pk:'COMPANY_BOOK_BALANCES',sk:line.account+'#'+E.hash(line.dimension||'GENERAL')};
    const before=await get(c,k),nature=line.account==='COMPANY_PAYABLE'?'CREDIT':'DEBIT';
    const nextBalance=E.add(before?.balanceMinor||0,line.side===nature?line.amountMinor:-line.amountMinor);
    if(nextBalance<0)E.fail('COMPANY_DOCUMENT_BALANCE_INSUFFICIENT',409);
    const entry={...k,kind:'COMPANY_BOOK_BALANCE',account:line.account,dimension:line.dimension||null,balanceMinor:nextBalance,version:(before?.version||0)+1,status:'ACTIVE',updatedAt:now};
    ops.push(put(c,entry,before));
   }
   if(['OPENING_RECEIVABLE','OPENING_PAYABLE'].includes(row.type))ops.push(put(c,{pk:'COMPANY_OPENING#'+E.hash({type:row.type,counterparty:row.counterparty.trim().toUpperCase()}),sk:'META',documentId:row.documentId}));
   if(row.type==='OPENING')ops.push(put(c,{pk:'COMPANY_OPENING#'+row.accountPin.accountId,sk:'META',documentId:row.documentId}));
   const proof={pk:'COMPANY_DOCUMENT_PROOF#'+E.hash({type:row.type,reference:row.reference.toUpperCase(),counterparty:row.counterparty.toUpperCase()}),sk:'META',documentId:row.documentId};ops.push(put(c,proof));
   if(row.reversedDocumentId){const original=await get(c,{pk:'COMPANY_DOCUMENT#'+row.reversedDocumentId,sk:'META'});if(!original||E.hash(original)!==row.originalDigest)E.fail('COMPANY_REVERSAL_INVALID');ops.push(put(c,{pk:'COMPANY_REVERSAL#'+row.reversedDocumentId,sk:'META',documentId:row.documentId,postedAt:now}));}
  }
  try{await c.db.send(new TransactWriteCommand({TransactItems:ops}));}catch(e){if(e.name==='TransactionCanceledException')E.fail('COMPANY_DOCUMENT_CONFLICT',409);throw e;}return{document:next};
 }
 E.fail('COMPANY_ACTION_INVALID');
}
module.exports={route,PATH,fields,tables,data,list,makeDocument,parseAmount};
