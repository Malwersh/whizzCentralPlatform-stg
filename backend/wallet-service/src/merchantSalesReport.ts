import {prepareDriverOfferFinancialSnapshot} from './driverOfferOrderReader';
import {quoteCanonical} from './deliveryQuoteRecord';
import {docClient,ScanCommand} from './db';
import {fundingError} from './fundingService';
import {statementPeriod,csvCell} from './walletStatement';
export const salesFields=['PK','SK','businessId','storeId','merchantId','createdAt','status','currency','pricing','total','subtotal','createdBy','financialSnapshot'];
const fail=(code:string,status=409):never=>{throw fundingError('تعذر إعداد تقرير مبيعات مكتمل',code,status);};
// Prove the legacy subunit format from BOTH compatibility amounts and the full
// pricing equation. A plausible magnitude or role name is never a unit marker.
export function orderPrice(row:Record<string,any>){
 const p=row.pricing;
 if(row.currency!=='IQD'||row.createdBy!=='wizzuser_app'||!p||typeof p!=='object')return null;
 const keys=['goodsSubtotal','serviceFee','packagingFee','deliveryFee','tax','tip','rounding','total'];
 if(keys.some(k=>!Number.isSafeInteger(p[k]))||keys.filter(k=>k!=='rounding').some(k=>p[k]<0))return null;
 const discount=p.discount===undefined?0:p.discount;
 if(!Number.isSafeInteger(discount)||discount<0)return null;
 const calculated=keys.filter(k=>k!=='total').reduce((sum,k)=>sum+BigInt(p[k]),0n)-BigInt(discount);
 if(BigInt(p.total)!==(calculated<0n?0n:calculated)||!Number.isSafeInteger(row.total)||!Number.isSafeInteger(row.subtotal)||row.total!==Math.round(p.total/1000)||row.subtotal!==Math.round(p.goodsSubtotal/1000))return null;
 // Keep integers in source subunits throughout aggregation; do not round per order.
 return {goods:BigInt(p.goodsSubtotal),discount:BigInt(discount),checkout:BigInt(p.total)};
}
export function aggregateSales(rows:Record<string,any>[]){
 const counts:Record<string,number>=Object.create(null);let completed=0,unclassified=0;
 const sums={goods:0n,discount:0n,checkout:0n};
 for(const row of rows){
  counts[row.status]=(counts[row.status]||0)+1;
  if(!['delivered','completed'].includes(row.status))continue;
  completed++;const price=orderPrice(row);if(!price){unclassified++;continue;}
  for(const key of ['goods','discount','checkout'] as const)sums[key]+=price[key];
 }
 const base={ruleVersion:'MERCHANT_SALES_V1',orderCount:rows.length,completedOrderCount:completed,unclassifiedCompletedCount:unclassified,countsByStatus:counts,currency:'IQD',sourceUnitsPerIQD:1000,basis:'CURRENT_COMPLETED_STATUS_BY_CREATION_DATE_ORIGINAL_ORDER_PRICES'};
 if(unclassified)return {...base,status:'UNAVAILABLE',reason:'UNPROVEN_PRICE_UNIT_OR_EQUATION'};
 if(Object.values(sums).some(v=>v>BigInt(Number.MAX_SAFE_INTEGER)))return {...base,status:'UNAVAILABLE',reason:'UNSAFE_TOTAL'};
 return {...base,status:'AVAILABLE',totalsSubunits:{goods:Number(sums.goods),discount:Number(sums.discount),checkout:Number(sums.checkout)}};
}
// A summary export contains no customer fields or individual order identifiers.
export function exportSalesReport(report:{businessId:string;period:ReturnType<typeof statementPeriod>;summary:ReturnType<typeof aggregateSales>;consistency:string},generatedAt=new Date().toISOString()){
 const summary=report.summary;
 const rows:unknown[][]=[
  ['report_type','MERCHANT_ORDER_SALES_SUMMARY'],['businessId',report.businessId],
  ['from_UTC',report.period.from],['through_UTC',report.period.to],['generated_at_UTC',generatedAt],
  ['currency','IQD'],['source_units_per_IQD',1000],['rule_version',summary.ruleVersion],
  ['basis',summary.basis],['consistency',report.consistency],['summary_status',summary.status],
  ['order_count',summary.orderCount],['completed_order_count',summary.completedOrderCount],
  ['unclassified_completed_count',summary.unclassifiedCompletedCount],
  ['notice','Original invoice prices by creation date and current completed status; not collections, profit, settlement or net of refunds. Discounts include all sources.'],
 ];
 if('totalsSubunits' in summary){
  const dinars=(value:number)=>{const whole=BigInt(value)/1000n,fraction=String(BigInt(value)%1000n).padStart(3,'0').replace(/0+$/,'');return fraction?`${whole}.${fraction}`:String(whole);};
  rows.push(['metric','amount_IQD','amount_subunits']);
  for(const [key,value] of Object.entries(summary.totalsSubunits))rows.push([key,dinars(value),value]);
 }else rows.push(['unavailable_reason',summary.reason]);
 rows.push(['order_status','count'],...Object.entries(summary.countsByStatus).sort(([a],[b])=>a.localeCompare(b)));
 const csv='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
 if(Buffer.byteLength(csv,'utf8')>512000)fail('REPORT_TOO_LARGE',413);
 return {...report,csv,filename:`branch-sales-report-${report.period.from}-${report.period.to}.csv`,generatedAt};
}
export async function merchantSalesReport(businessId:string,period:ReturnType<typeof statementPeriod>){
 const names=Object.fromEntries(salesFields.map((k,i)=>['#f'+i,k]));
 const rows:Record<string,any>[]=[],seen=new Set<string>();let cursor:Record<string,any>|undefined;
 // Bounded Staging bridge: complete the base-table read or return no report.
 // A status GSI or paginated UI list cannot prove coverage of legacy storeId rows.
 for(let page=0;page<12;page++){
  const result=await docClient.send(new ScanCommand({TableName:'WizzOrders',ConsistentRead:true,Limit:250,ProjectionExpression:Object.keys(names).join(','),ExpressionAttributeNames:names,FilterExpression:'#f1=:meta AND (#f2=:branch OR #f3=:branch OR #f4=:branch) AND #f5>=:start AND #f5<:end',ExpressionAttributeValues:{':meta':'META',':branch':businessId,':start':period.start,':end':period.endExclusive},...(cursor?{ExclusiveStartKey:cursor}:{})}));
  for(const row of result.Items||[]){
   let merchantIsParty=false;
   if(row.financialSnapshot!==undefined){try{
    const saved=prepareDriverOfferFinancialSnapshot(row.financialSnapshot.snapshot);
    if(quoteCanonical(saved)!==quoteCanonical(row.financialSnapshot)||row.PK!=='ORDER#'+saved.snapshot.orderId||
       saved.snapshot.branchId!==businessId||saved.snapshot.merchantId!==row.merchantId)fail('SALES_DATA_UNAVAILABLE');
    merchantIsParty=true;
   }catch{fail('SALES_DATA_UNAVAILABLE');}}
   const scope=[row.businessId,row.storeId,...(merchantIsParty?[]:[row.merchantId])].filter(v=>v!==undefined&&v!==null&&v!=='');
   if(!scope.length||scope.some(v=>v!==businessId)||row.SK!=='META'||typeof row.PK!=='string'||!row.PK.startsWith('ORDER#')||typeof row.createdAt!=='string'||!Number.isFinite(Date.parse(row.createdAt))||new Date(row.createdAt).toISOString()!==row.createdAt||row.createdAt<period.start||row.createdAt>=period.endExclusive||typeof row.status!=='string'||!row.status||row.status.length>80)fail('SALES_DATA_UNAVAILABLE');
   if(seen.has(row.PK))fail('SALES_DATA_UNAVAILABLE');seen.add(row.PK);rows.push(row);
  }
  if(rows.length>500)fail('REPORT_TOO_LARGE',413);
  cursor=result.LastEvaluatedKey;if(!cursor)return {businessId,period,complete:true,summary:aggregateSales(rows),consistency:'LIVE_BASE_TABLE_READ_NOT_ACCOUNTING_SNAPSHOT'};
 }
 return fail('REPORT_TOO_LARGE',413);
}
