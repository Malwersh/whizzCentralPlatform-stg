'use strict';
const {QueryCommand}=require('@aws-sdk/lib-dynamodb');
const {error}=require('./policy');
const {digest}=require('./commercial-retention');
const P='staging-MerchantPlatform',S='staging-PlatformStaff';
const fail=()=>{throw error('SETTLEMENT_SCHEDULE_RETENTION_INVALID');};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const employeeId=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const same=(a,b)=>digest(a)===digest(b);
function fields(row,allowed){if(Object.keys(row).some(k=>!allowed.split(' ').includes(k)&&!['legalHold','retentionHold'].includes(k))||Buffer.byteLength(JSON.stringify(row))>250000)fail();}
function schedule(v){if(!v||Object.keys(v).sort().join(',')!=='anchorLocalDate,frequency,schemaVersion,timezone,version'||v.schemaVersion!==1||!Number.isSafeInteger(v.version)||v.version<1||v.timezone!=='Asia/Baghdad'||!['WEEKLY','FORTNIGHTLY','MONTHLY'].includes(v.frequency)||typeof v.anchorLocalDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v.anchorLocalDate)||!Number.isFinite(Date.parse(v.anchorLocalDate+'T00:00:00.000Z'))||new Date(v.anchorLocalDate+'T00:00:00.000Z').toISOString().slice(0,10)!==v.anchorLocalDate)fail();}
function common(row,branchId,ownerId){
 if(row.schemaVersion!==1||row.branchId!==branchId||row.ownerId!==ownerId||!iso(row.effectiveFrom)||row.effectiveTo!==null&&(!iso(row.effectiveTo)||row.effectiveTo<=row.effectiveFrom))fail();schedule(row.schedule);
 if(!row.agreement||Object.keys(row.agreement).sort().join(',')!=='id,termsHash,version'||typeof row.agreement.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_:#.-]{0,149}$/.test(row.agreement.id)||!Number.isSafeInteger(row.agreement.version)||row.agreement.version<1||!hash(row.agreement.termsHash))fail();
}
/** Complete branch-specific inventory, no Scan, source mutations or guessed refs.
 * All proposal/consent/approval audit links must exist before any archive write. */
async function settlementScheduleInventory({db,branchId,ownerId,maxPages=30}){
 if(!Number.isSafeInteger(maxPages)||maxPages<1)fail();
 async function query(table,pk,prefix){let cursor;const rows=[];for(let n=0;n<maxPages;n++){
  const out=await db.send(new QueryCommand({TableName:table,ConsistentRead:true,Limit:100,KeyConditionExpression:'pk=:pk'+(prefix?' AND begins_with(sk,:prefix)':''),ExpressionAttributeValues:{':pk':pk,...(prefix?{':prefix':prefix}:{})},...(cursor?{ExclusiveStartKey:cursor}:{})}));rows.push(...out.Items||[]);cursor=out.LastEvaluatedKey;if(!cursor)return rows;
 }throw error('SETTLEMENT_SCHEDULE_INVENTORY_INCOMPLETE');}
 const pk='BRANCH#'+branchId,rows=await query(P,pk,'SETTLEMENT_SCHEDULE#'),audits=await query(S,'SETTLEMENT_SCHEDULE_AUDIT#'+branchId);
 const items=[...rows.map(row=>({table:P,row})),...audits.map(row=>({table:S,row}))];
 if(items.some(x=>x.row.legalHold===true||x.row.retentionHold===true))throw error('DOCUMENTED_RETENTION_HOLD');
 const seen=new Set();for(const {table,row}of items){const identity=table+'|'+row.pk+'|'+row.sk;if(seen.has(identity))fail();seen.add(identity);}
 let current;const versions=new Map(),closures=new Map(),proposals=new Map(),events=new Map();
 for(const row of rows){if(row.pk!==pk)fail();
  if(row.kind==='MERCHANT_SETTLEMENT_SCHEDULE'){
   fields(row,'pk sk schemaVersion kind branchId ownerId enabled status schedule agreement effectiveFrom effectiveTo acceptedBy acceptedAt approvedBy approvedAt digest');common(row,branchId,ownerId);
   const {pk:_p,sk:_s,digest:saved,...body}=row;
   if(row.enabled!==true||row.status!=='APPROVED'||row.acceptedBy!==ownerId||!iso(row.acceptedAt)||!employeeId(row.approvedBy)||!iso(row.approvedAt)||row.acceptedAt>row.effectiveFrom||row.approvedAt>row.effectiveFrom||!hash(saved)||digest(body)!==saved)fail();
   if(row.sk==='SETTLEMENT_SCHEDULE#CURRENT'){if(current)fail();current=row;}
   else if(row.sk==='SETTLEMENT_SCHEDULE#VERSION#'+row.schedule.version){if(versions.has(row.schedule.version))fail();versions.set(row.schedule.version,row);}else fail();
  }else if(row.kind==='MERCHANT_SETTLEMENT_SCHEDULE_PROPOSAL'){
   fields(row,'pk sk schemaVersion kind branchId proposalId requestHash baseVersion schedule ownerId agreement effectiveFrom effectiveTo requestedBy createdAt proposalDigest approvalPolicy status acceptedBy acceptedAt approvedBy approvedAt');common(row,branchId,ownerId);
   const {pk:_p,sk:_s,proposalDigest,status,acceptedBy,acceptedAt,approvedBy,approvedAt,...body}=row;
   if(!uuid(row.proposalId)||row.sk!=='SETTLEMENT_SCHEDULE#PROPOSAL#'+row.proposalId||!employeeId(row.requestedBy)||!hash(row.requestHash)||!iso(row.createdAt)||!Number.isSafeInteger(row.baseVersion)||row.baseVersion<0||row.schedule.version!==row.baseVersion+1||digest(body)!==proposalDigest||!['AWAITING_OWNER','AWAITING_APPROVAL','APPROVED'].includes(status)||proposals.has(row.proposalId))fail();
   if(status==='AWAITING_OWNER'?[acceptedBy,acceptedAt,approvedBy,approvedAt].some(x=>x!==undefined):acceptedBy!==ownerId||!iso(acceptedAt)||acceptedAt<row.createdAt)fail();
   if(status==='AWAITING_APPROVAL'&&(approvedBy!==undefined||approvedAt!==undefined))fail();
   if(row.approvalPolicy!==undefined&&!['SINGLE_ADMIN','INDEPENDENT'].includes(row.approvalPolicy))fail();
   if(status==='APPROVED'&&(!employeeId(approvedBy)||approvedBy===row.requestedBy&&row.approvalPolicy!=='SINGLE_ADMIN'||!iso(approvedAt)||approvedAt<acceptedAt))fail();proposals.set(row.proposalId,row);
  }else if(row.kind==='MERCHANT_SETTLEMENT_SCHEDULE_CLOSURE'){
   fields(row,'pk sk schemaVersion kind branchId version sourceDigest untilExclusive replacedByVersion proposalId createdAt');
   if(row.schemaVersion!==1||row.branchId!==branchId||!Number.isSafeInteger(row.version)||row.version<1||row.sk!=='SETTLEMENT_SCHEDULE#CLOSED#'+row.version||row.replacedByVersion!==row.version+1||!hash(row.sourceDigest)||!uuid(row.proposalId)||!iso(row.untilExclusive)||!iso(row.createdAt)||closures.has(row.version))fail();closures.set(row.version,row);
  }else fail();
 }
 if(versions.size){if(!current||versions.size!==current.schedule.version||versions.get(versions.size)?.digest!==current.digest)fail();}
 else if(current||closures.size)fail();
 const approved=new Map();for(const p of proposals.values())if(p.status==='APPROVED'){if(approved.has(p.schedule.version))fail();approved.set(p.schedule.version,p);}
 if(approved.size!==versions.size||closures.size!==Math.max(0,versions.size-1))fail();
 for(let n=1;n<=versions.size;n++){
  const v=versions.get(n),p=approved.get(n);if(!v||!p||!['schedule','agreement','effectiveFrom','effectiveTo','acceptedBy','acceptedAt','approvedBy','approvedAt'].every(k=>same(v[k],p[k])))fail();
  if(n<versions.size){const next=versions.get(n+1),closure=closures.get(n),nextProposal=approved.get(n+1);
   if(!next||!closure||closure.sourceDigest!==v.digest||closure.untilExclusive!==next.effectiveFrom||closure.proposalId!==nextProposal?.proposalId||closure.createdAt!==next.approvedAt||v.effectiveFrom>=next.effectiveFrom)fail();
  }
 }
 for(const row of audits){fields(row,'pk sk action actorId branchId proposalId digest createdAt');
  const p=proposals.get(row.proposalId);if(!p||row.pk!=='SETTLEMENT_SCHEDULE_AUDIT#'+branchId||row.branchId!==branchId||!iso(row.createdAt)||row.sk!==row.proposalId+'#'+row.action||events.has(row.sk))fail();
  const expected=row.action==='SCHEDULE_PROPOSED'?[p.requestedBy,p.createdAt,p.proposalDigest]:row.action==='SCHEDULE_OWNER_CONSENTED'&&p.status!=='AWAITING_OWNER'?[p.acceptedBy,p.acceptedAt,p.proposalDigest]:row.action==='SCHEDULE_APPROVED'&&p.status==='APPROVED'?[p.approvedBy,p.approvedAt,versions.get(p.schedule.version)?.digest]:null;
  if(!expected||!same(expected,[row.actorId,row.createdAt,row.digest]))fail();events.set(row.sk,row);
 }
 for(const p of proposals.values())for(const action of ['SCHEDULE_PROPOSED',...(p.status!=='AWAITING_OWNER'?['SCHEDULE_OWNER_CONSENTED']:[]),...(p.status==='APPROVED'?['SCHEDULE_APPROVED']:[])])if(!events.has(p.proposalId+'#'+action))fail();
 return items;
}
module.exports={settlementScheduleInventory};
