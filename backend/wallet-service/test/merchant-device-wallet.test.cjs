const test=require('node:test'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
process.env.ENVIRONMENT='staging';
const {docClient,TABLES,GetCommand}=require('../dist/db');
const {readMerchantDeviceWallet,runtimeAttributes}=require('../dist/merchantDeviceWallet');
const {handler}=require('../dist/merchantDeviceWallet');
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture(){
 const rows=new Map(),calls=[],audits=[],activities=[],d='11111111-1111-4111-8111-111111111111',s='22222222-2222-4222-8222-222222222222',secret='a'.repeat(43),sessionSecret='b'.repeat(43),T='staging-MerchantPlatform',pk='BRANCH#b';let race=false,auditFailure=false,activityFailure=false;
 const k=(table,key)=>table+'|'+JSON.stringify(key),put=(table,key,row)=>rows.set(k(table,key),{...key,...row}),get=(table,key)=>rows.get(k(table,key));
 put('WhizzMerchants_Businesses',{businessId:'b'},{ownerId:'owner',cognitoUserId:'owner',status:'approved',email:'hidden-owner-email'});
 put(T,{pk,sk:'DEVICE#'+d},{deviceId:d,businessId:'b',ownerId:'owner',version:1,status:'ACTIVE',expiresAt:Date.now()/1000+3600,tokenHash:hash(secret)});
 const permissions=['branch.read','wallet.balance.read','wallet.transactions.read','wallet.export','reports.sales.read','reports.export'];
 put(T,{pk,sk:'MEMBER#employee'},{subjectId:'employee',businessId:'b',ownerId:'owner',version:1,status:'ACTIVE',role:'finance-read',permissionSchema:2,grant:{roleId:'finance-read',roleVersion:1,policyVersion:1,branchIds:['b'],permissions}});
 put(T,{pk,sk:'PIN#employee'},{membershipVersion:1,version:1,salt:'never-read-salt',digest:'never-read-digest'});
 put(T,{pk,sk:'STAFF_SESSION#'+s},{sessionId:s,subjectId:'employee',businessId:'b',deviceId:d,deviceVersion:1,membershipVersion:1,pinVersion:1,status:'ACTIVE',version:1,expiresAt:Date.now()/1000+3600,tokenHash:hash(sessionSecret)});
 put('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'},{version:1,enabledPermissions:permissions,roles:[{id:'finance-read',version:1,nameAr:'قارئ مالي',enabled:true,permissions}]});
 put(TABLES.WALLETS,{walletId:'WALLET#MERCHANT#b',sk:'META'},{ownerType:'MERCHANT',ownerId:'b',status:'ACTIVE',currency:'IQD',availableBalance:15000,lockedBalance:2000,secretPayment:'never-return'});
 docClient.send=async c=>{
  calls.push(c);const x=c.input,name=c instanceof GetCommand?'GetCommand':c.constructor.name;
  if(name==='GetCommand'){let row=structuredClone(get(x.TableName,x.Key));if(row&&x.ProjectionExpression){const fields=x.ProjectionExpression.split(',').map(n=>x.ExpressionAttributeNames?.[n.trim()]||n.trim());row=Object.fromEntries(fields.filter(f=>row[f]!==undefined).map(f=>[f,row[f]]));}return {Item:row};}
  if(name==='QueryCommand')return {Items:[{walletId:'WALLET#MERCHANT#b',sk:'ts#one',amount:500,category:'TRANSFER',description:'حركة',metadata:{token:'secret'}},{walletId:'WALLET#MERCHANT#foreign',sk:'ts#foreign',amount:999}],LastEvaluatedKey:{walletId:'WALLET#MERCHANT#b',sk:'ts#one'}};
  if(name==='TransactWriteCommand'){
   const audited=x.TransactItems.some(op=>op.Put?.TableName===TABLES.AUDIT_LOG);
   if(audited&&race)get(T,{pk,sk:'MEMBER#employee'}).version++;
   if(audited&&(auditFailure||activityFailure&&x.TransactItems.some(op=>op.Put?.TableName===T)))throw Error('audit unavailable');
   for(const op of x.TransactItems){if(!op.ConditionCheck)continue;const q=op.ConditionCheck,row=get(q.TableName,q.Key);if(q.ConditionExpression==='attribute_not_exists(pk)'&&row||q.ExpressionAttributeValues?.[':v']!==undefined&&row?.version!==q.ExpressionAttributeValues[':v'])throw Object.assign(Error('conflict'),{name:'TransactionCanceledException'});}
   for(const op of x.TransactItems)if(op.Put?.TableName===TABLES.AUDIT_LOG)audits.push(op.Put.Item);for(const op of x.TransactItems)if(op.Put?.TableName===T)activities.push(op.Put.Item);return {};
  }
  throw Error('unexpected mutation '+name);
 };
 const event=(kind='balance',query={})=>({path:'/wallet/branch-device/'+kind,httpMethod:'GET',headers:{Authorization:'Bearer b:'+d+':'+secret,'X-Staff-Session':s+':'+sessionSecret},queryStringParameters:{businessId:'b',...query},requestContext:{authorizer:{userType:'merchant',userId:'owner',financeManager:true}}});
 return {event,read:(kind='balance',query={})=>readMerchantDeviceWallet(event(kind,query)),calls,audits,activities,failActivity:()=>activityFailure=true,member:get(T,{pk,sk:'MEMBER#employee'}),device:get(T,{pk,sk:'DEVICE#'+d}),policy:get('staging-PlatformStaff',{pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'}),rows,race:()=>race=true,failAudit:()=>auditFailure=true};
}
const walletCalls=f=>f.calls.filter(c=>[TABLES.WALLETS,TABLES.LEDGER].includes(c.input.TableName));
test('real canonical device/session guard reads a narrow balance and logs sensitive access without PIN data',async()=>{const f=fixture(),r=await f.read();assert.equal(r.availableBalance,15000);assert.equal(r.secretPayment,undefined);assert.equal(r.ownerId,undefined);assert.equal(f.audits.length,1);assert.equal(f.audits[0].actorId,'employee');assert.equal(f.audits[0].policyVersion,1);assert.ok(!runtimeAttributes.includes('digest'));const pin=f.calls.find(c=>c.input.Key?.sk==='PIN#employee');assert.ok(pin.input.ProjectionExpression);assert.ok(!Object.values(pin.input.ExpressionAttributeNames).includes('digest'));assert.ok(!JSON.stringify(f.audits).includes('tokenHash'));});
test('ledger reads are branch-bound and paginated with an explicit field projection',async()=>{const f=fixture(),r=await f.read('transactions');assert.equal(r.transactions.length,1);assert.equal(r.transactions[0].metadata,undefined);const cursor=JSON.parse(Buffer.from(r.nextCursor,'base64url'));assert.equal(cursor.walletId,'WALLET#MERCHANT#b');const query=f.calls.find(c=>c.constructor.name==='QueryCommand').input;assert.equal(query.Limit,30);assert.equal(query.ConsistentRead,true);assert.equal(query.ExpressionAttributeValues[':wallet'],'WALLET#MERCHANT#b');});
test('forged gateway owner context, locked session and operational/legacy memberships cannot read a wallet',async()=>{for(const kind of ['locked','operational','legacy','revokedDevice']){const f=fixture();let event=f.event();if(kind==='locked')delete event.headers['X-Staff-Session'];if(kind==='operational')f.member.grant.permissions=['branch.read','orders.read'];if(kind==='legacy'){delete f.member.permissionSchema;delete f.member.grant;f.member.role='FINANCE';}if(kind==='revokedDevice')f.device.status='REVOKED';await assert.rejects(readMerchantDeviceWallet(event));assert.equal(walletCalls(f).length,0);assert.equal(f.audits.length,0);}});
test('foreign branch, foreign cursor and arbitrary wallet ids are rejected',async()=>{for(const query of [{businessId:'foreign'},{walletId:'WALLET#MERCHANT#foreign'},{cursor:Buffer.from(JSON.stringify({walletId:'WALLET#MERCHANT#foreign',sk:'ts#x'})).toString('base64url')}]){const f=fixture();await assert.rejects(f.read('transactions',query));assert.equal(walletCalls(f).length,0);}});
test('central blocking and a policy outage prevent financial data reads',async()=>{for(const missing of [false,true]){const f=fixture();if(missing)f.rows.delete('staging-PlatformStaff|'+JSON.stringify({pk:'OPERATIONAL_SETTINGS#MERCHANT_STAFF_PERMISSIONS',sk:'CURRENT'}));else f.policy.enabledPermissions=['branch.read'];await assert.rejects(f.read());assert.equal(walletCalls(f).length,0);}});
test('revocation between reading and responding and an audit failure never release data',async()=>{for(const mode of ['race','failAudit']){const f=fixture();f[mode]();await assert.rejects(f.read());assert.equal(f.audits.length,0);}});
test('wallet is never provisioned by a read and financial mutations are denied on this transport',async()=>{let f=fixture();for(const key of [...f.rows.keys()])if(key.startsWith(TABLES.WALLETS+'|'))f.rows.delete(key);await assert.rejects(f.read(),e=>e.code==='WALLET_UNAVAILABLE');assert.ok(f.calls.every(c=>!c.input.TransactItems?.some(op=>op.Put?.TableName===TABLES.WALLETS)));f=fixture();const event=f.event('request');event.httpMethod='POST';const response=await handler(event);assert.equal(response.statusCode,403);assert.equal(walletCalls(f).length,0);});

test('statements and CSV require the live read/export grants and audit before release',async()=>{
 const f=fixture(),send=docClient.send;let query;
 docClient.send=async c=>{if(c.constructor.name==='QueryCommand'){query=c.input;return {Items:[{walletId:'WALLET#MERCHANT#b',sk:'ts#2026-01-02T12:00:00.000Z#x',type:'CREDIT',amount:500,description:'=HYPERLINK("bad")',metadata:{secret:'hidden'}}]};}return send(c);};
 const result=await f.read('statement',{from:'2026-01-01',to:'2026-01-03',format:'csv'});
 assert.equal(result.complete,true);assert.equal(result.rowCount,1);assert.equal(result.entries[0].metadata,undefined);assert.ok(result.csv.includes("'=HYPERLINK"));assert.ok(!result.csv.includes('hidden'));assert.equal(query.ScanIndexForward,true);assert.equal(query.ExpressionAttributeValues[':start'],'ts#2026-01-01T00:00:00.000Z');assert.equal(f.audits[0].action,'MERCHANT_STAFF_STATEMENT_EXPORT');assert.equal(f.audits[0].rowCount,1);assert.equal(f.audits[0].effectRuleVersion,'LEDGER_EFFECTS_V7');assert.equal(f.audits[0].effectSummaryStatus,'UNAVAILABLE');assert.equal(f.audits[0].periodTo,'2026-01-03');
 f.member.grant.permissions=['branch.read','wallet.transactions.read'];
 await assert.rejects(f.read('statement',{from:'2026-01-01',to:'2026-01-03',format:'csv'}),e=>e.code==='PERMISSION_REQUIRED');
});
test('statements reject invalid periods, incomplete ranges and revocation after the ledger read',async()=>{
 for(const mode of ['invalid','partial','race','failAudit']){
  const f=fixture(),send=docClient.send;let count=0;
  docClient.send=async c=>{if(c.constructor.name==='QueryCommand'){count++;return {Items:[],...(mode==='partial'?{LastEvaluatedKey:{walletId:'WALLET#MERCHANT#b',sk:'ts#2026-01-02T00:00:00.000Z#'+count}}:{})};}return send(c);};
  if(mode==='race'||mode==='failAudit')f[mode]();
  await assert.rejects(f.read('statement',{from:mode==='invalid'?'2026-02-30':'2026-01-01',to:'2026-01-03'}));
  assert.equal(f.audits.length,0);if(mode==='invalid')assert.equal(walletCalls(f).length,0);if(mode==='partial')assert.equal(count,8);
 }
});

test('sales report uses device policy and post-read audit without needing or reading a wallet',async()=>{
 const f=fixture(),send=docClient.send;
 f.member.grant.permissions=['branch.read','reports.sales.read','reports.export'];
 docClient.send=async c=>c.constructor.name==='ScanCommand'?{Items:[]}:send(c);
 const r=await f.read('sales-report',{from:'2026-01-01',to:'2026-01-02'});
 assert.equal(r.summary.orderCount,0);assert.equal(f.audits[0].action,'MERCHANT_STAFF_SALES_REPORT_READ');assert.equal(f.audits[0].reportRuleVersion,'MERCHANT_SALES_V1');assert.equal(walletCalls(f).length,0);
});
test('sales report is withheld when membership changes after the scan or auditing fails',async()=>{
 for(const mode of ['race','failAudit']){
  const f=fixture(),send=docClient.send;f[mode]();
  docClient.send=async c=>c.constructor.name==='ScanCommand'?{Items:[]}:send(c);
  await assert.rejects(f.read('sales-report',{from:'2026-01-01',to:'2026-01-02'}));assert.equal(f.audits.length,0);
 }
});
test('wallet access alone never authorizes sales reads',async()=>{
 const f=fixture();f.member.grant.permissions=['branch.read','wallet.balance.read','wallet.transactions.read'];
 await assert.rejects(f.read('sales-report',{from:'2026-01-01',to:'2026-01-02'}),e=>e.code==='PERMISSION_REQUIRED');
 assert.equal(f.calls.filter(c=>c.constructor.name==='ScanCommand').length,0);assert.equal(f.audits.length,0);
});

test('sales export needs both report read and report export; wallet export is insufficient',async()=>{
 for(const rights of [['branch.read','reports.sales.read','wallet.export','wallet.transactions.read'],['branch.read','reports.export']]){
  const f=fixture();f.member.grant.permissions=rights;
  await assert.rejects(f.read('sales-report',{from:'2026-01-01',to:'2026-01-02',format:'csv'}),e=>e.code==='PERMISSION_REQUIRED');assert.equal(f.calls.filter(c=>c.constructor.name==='ScanCommand').length,0);
 }
 const f=fixture(),send=docClient.send;docClient.send=async c=>c.constructor.name==='ScanCommand'?{Items:[]}:send(c);
 const result=await f.read('sales-report',{from:'2026-01-01',to:'2026-01-02',format:'csv'});assert.ok(result.csv);assert.equal(f.audits[0].action,'MERCHANT_STAFF_SALES_REPORT_EXPORT');
});
test('sales export is withheld when the issued session loses its grant during the read',async()=>{
 for(const mode of ['race','failAudit']){
  const f=fixture(),send=docClient.send;f[mode]();docClient.send=async c=>c.constructor.name==='ScanCommand'?{Items:[]}:send(c);
  await assert.rejects(f.read('sales-report',{from:'2026-01-01',to:'2026-01-02',format:'csv'}));assert.equal(f.audits.length,0);
 }
});

test('each financial read/export records one linked owner event in the same fenced transaction',async()=>{
 for(const [kind,format,action] of [['balance','json','MERCHANT_STAFF_BALANCE_READ'],['transactions','json','MERCHANT_STAFF_TRANSACTIONS_READ'],['statement','json','MERCHANT_STAFF_STATEMENT_READ'],['statement','csv','MERCHANT_STAFF_STATEMENT_EXPORT'],['sales-report','json','MERCHANT_STAFF_SALES_REPORT_READ'],['sales-report','csv','MERCHANT_STAFF_SALES_REPORT_EXPORT']]){
  const f=fixture(),send=docClient.send;f.member.displayName='أحمد';f.member.grant.roleNameAr='مالي';
  docClient.send=async c=>['QueryCommand','ScanCommand'].includes(c.constructor.name)?{Items:[]}:send(c);
  await f.read(kind,['statement','sales-report'].includes(kind)?{from:'2026-01-01',to:'2026-01-02',format}:{});
  assert.equal(f.audits.length,1);assert.equal(f.activities.length,1);const a=f.activities[0];assert.equal(a.action,action);assert.equal(a.ownerId,'owner');assert.equal(a.actorId,'employee');assert.equal(a.actorName,'أحمد');assert.equal(a.roleName,'مالي');assert.equal(a.entityId,'b');assert.equal(a.format,format);assert.ok(a.sk.endsWith(f.audits[0].sk));assert.equal(a.availableBalance,undefined);assert.equal(a.transactions,undefined);assert.equal(a.tokenHash,undefined);assert.equal(a.csv,undefined);assert.equal(a.before,undefined);assert.equal(a.after,undefined);
  const tx=f.calls.at(-1).input.TransactItems;assert.equal(tx.filter(x=>x.Put).length,2);assert.ok(tx.some(x=>x.ConditionCheck?.TableName==='staging-PlatformStaff'));
 }
});
test('failure to record the owner activity prevents financial delivery and either audit success',async()=>{for(const kind of ['balance','transactions','statement','sales-report']){const f=fixture(),send=docClient.send;f.failActivity();docClient.send=async c=>['QueryCommand','ScanCommand'].includes(c.constructor.name)?{Items:[]}:send(c);await assert.rejects(f.read(kind,['statement','sales-report'].includes(kind)?{from:'2026-01-01',to:'2026-01-02',format:'csv'}:{}));assert.equal(f.audits.length,0);assert.equal(f.activities.length,0);}});

test('bundling may rename the SDK class without bypassing the PIN projection',async()=>{
 const original=GetCommand.name;
 try{Object.defineProperty(GetCommand,'name',{value:'BundledGetCommand',configurable:true});const f=fixture();await f.read();const pin=f.calls.find(c=>c.input.Key?.sk==='PIN#employee');assert.ok(pin.input.ProjectionExpression);assert.equal(Object.values(pin.input.ExpressionAttributeNames).includes('digest'),false);}
 finally{Object.defineProperty(GetCommand,'name',{value:original,configurable:true});}
});
