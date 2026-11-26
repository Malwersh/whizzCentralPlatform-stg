import {docClient,TABLES,QueryCommand} from './db';
import {fundingError} from './fundingService';
import {summarizeLedger} from './ledgerEffects';
const fields=['walletId','sk','transactionId','txnId','type','category','amount','balance','balanceBefore','balanceAfter','relatedEntityId','relatedEntityType','description','createdAt','timestamp'];
const invalid=(code:string,status=400):never=>{throw fundingError('تعذر إعداد كشف مكتمل؛ تحقق من الفترة أو اختر فترة أقصر',code,status);};
export function statementPeriod(from?:string,to?:string){
 const parse=(value?:string)=>{if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))invalid('INVALID_PERIOD');const date=new Date(value+'T00:00:00.000Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)invalid('INVALID_PERIOD');return date.getTime();};
 const start=parse(from),end=parse(to)+86400000;
 if(end<=start||end-start>31*86400000||end>Date.now())invalid('INVALID_PERIOD');
 return {from:from!,to:to!,start:new Date(start).toISOString(),endExclusive:new Date(end).toISOString(),timezone:'UTC'};
}
// Quote every cell and neutralize spreadsheet formulas in textual fields.
export function csvCell(value:unknown){let s=String(value??'');if(typeof value!=='number'&&/^[\s\u0000-\u001f]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
export async function walletStatement(walletId:string,period:ReturnType<typeof statementPeriod>,exportCsv:boolean){
 const names=Object.fromEntries(fields.map((f,i)=>['#f'+i,f]));
 const entries:Record<string,any>[]=[];const seen=new Set<string>();let cursor:Record<string,any>|undefined;
 for(let page=0;page<8;page++){
  const result=await docClient.send(new QueryCommand({TableName:TABLES.LEDGER,KeyConditionExpression:'walletId=:wallet AND sk BETWEEN :start AND :end',ExpressionAttributeValues:{':wallet':walletId,':start':'ts#'+period.start,':end':'ts#'+period.endExclusive},ExpressionAttributeNames:names,ProjectionExpression:Object.keys(names).join(','),ConsistentRead:true,ScanIndexForward:true,Limit:100,...(cursor?{ExclusiveStartKey:cursor}:{})}));
  for(const row of result.Items||[]){
   // Never present foreign, malformed or ambiguous records as a complete statement.
   if(row.walletId!==walletId||typeof row.sk!=='string'||row.sk<'ts#'+period.start||row.sk>='ts#'+period.endExclusive||!Number.isSafeInteger(row.amount))invalid('STATEMENT_DATA_UNAVAILABLE',409);
   if(seen.has(row.sk))invalid('STATEMENT_DATA_UNAVAILABLE',409);
   seen.add(row.sk);
   entries.push(Object.fromEntries(fields.filter(f=>f!=='walletId'&&row[f]!==undefined).map(f=>[f,row[f]])));
  }
  cursor=result.LastEvaluatedKey;
  if(entries.length>500||Buffer.byteLength(JSON.stringify(entries),'utf8')>512000)invalid('STATEMENT_TOO_LARGE',413);
  if(!cursor)break;
  if(cursor.walletId!==walletId||typeof cursor.sk!=='string')invalid('STATEMENT_DATA_UNAVAILABLE',409);
  if(page===7)invalid('STATEMENT_TOO_LARGE',413);
 }
 const counts:Record<string,number>=Object.create(null);
 for(const row of entries){const category=String(row.category||'UNSPECIFIED');counts[category]=(counts[category]||0)+1;}
 const normalized=summarizeLedger(entries);
 const columns=['effectStatus','effectBucket','effectDelta','sk','transactionId','txnId','type','category','amount','balanceBefore','balanceAfter','balance','description','relatedEntityId','createdAt','timestamp'];
 let csv:string|undefined;
 if(exportCsv){
  const summaryRows:unknown[][]=normalized.summary.status==='AVAILABLE'
   ?Object.entries(normalized.summary.totals).flatMap(([bucket,values])=>Object.entries(values).map(([key,value])=>[bucket+'_'+key,value]))
   :[['summary_reason',normalized.summary.reason]];
  const rows:unknown[][]=[
   ['walletId',walletId],['from_UTC',period.from],['through_UTC',period.to],['currency','IQD'],
   ['amount_semantics','recorded amount; effectDelta is the interpreted change to effectBucket'],
   ['effect_rule_version',normalized.summary.ruleVersion],['summary_status',normalized.summary.status],
   ...summaryRows,columns,
   ...normalized.entries.map(row=>columns.map(column=>{
    if(column==='effectStatus')return row.ledgerEffect.status;
    if(column==='effectBucket')return row.ledgerEffect.status==='CLASSIFIED'?row.ledgerEffect.bucket:'';
    if(column==='effectDelta')return row.ledgerEffect.status==='CLASSIFIED'?row.ledgerEffect.delta:'';
    return (row as Record<string,any>)[column]??'';
   }))
  ];
  csv='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
 }
 return {walletId,currency:'IQD',period,complete:true,rowCount:entries.length,countsByCategory:counts,entries:normalized.entries,effectSummary:normalized.summary,...(csv===undefined?{}:{csv,filename:`branch-statement-${period.from}-${period.to}.csv`}),balanceSemantics:'RECORDED_VALUES_ONLY',consistency:'LIVE_LEDGER_READ_NOT_ACCOUNTING_SNAPSHOT'};
}
