import {DynamoDBDocumentClient, QueryCommand} from '@aws-sdk/lib-dynamodb';
import {strongGet, exactCheck, equal} from './driverFinancialTransaction';
import {quoteEntityIdValid, quoteHash} from './deliveryQuoteRecord';
type Row=Record<string,any>;
export const MERCHANT_ACCRUAL_INDEX_TABLE='staging-MerchantPlatform';
export const merchantAccrualPartition=(branchId:string)=>'MERCHANT_ACCRUAL#'+branchId;
const fail=(code='SETTLEMENT_ACCRUAL_INDEX_INVALID'):never=>{throw Object.assign(Error(code),{code});};
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function merchantAccrualIndexRow(v:{branchId:string;orderId:string;operationId:string;deliveredAt:string;merchantNetIqd:number;financialSchemaVersion:number}){
 if(Object.keys(v).sort().join(',')!=='branchId,deliveredAt,financialSchemaVersion,merchantNetIqd,operationId,orderId')return fail();
 if(![v.branchId,v.orderId,v.operationId].every(quoteEntityIdValid)||!iso(v.deliveredAt)||!Number.isSafeInteger(v.merchantNetIqd)||v.merchantNetIqd<0||![2,3,4,5].includes(v.financialSchemaVersion))return fail();
 const content={schemaVersion:1,kind:'MERCHANT_ACCRUAL_INDEX_ENTRY',...v,retentionClass:'FINANCIAL_SETTLEMENT'};
 return {pk:merchantAccrualPartition(v.branchId),sk:'DELIVERED#'+v.deliveredAt+'#'+v.orderId,...content,digest:quoteHash(content)};
}
export function validateMerchantAccrualIndexRow(row:Row,branchId:string){
 if(!row||row.branchId!==branchId||!equal(row,merchantAccrualIndexRow({branchId:row.branchId,orderId:row.orderId,operationId:row.operationId,deliveredAt:row.deliveredAt,merchantNetIqd:row.merchantNetIqd,financialSchemaVersion:row.financialSchemaVersion})))return fail();
 return row;
}
export function validateMerchantAccrualIndexHead(row:Row|null,branchId:string,sk='HEAD'){
 if(row===null)return null;
 if(!row||Object.keys(row).sort().join(',')!=='branchId,kind,pk,retentionClass,revision,schemaVersion,sk,updatedAt'||row.pk!==merchantAccrualPartition(branchId)||row.sk!==sk||row.branchId!==branchId||row.kind!=='MERCHANT_ACCRUAL_INDEX_HEAD'||row.schemaVersion!==1||row.retentionClass!=='FINANCIAL_SETTLEMENT'||!Number.isSafeInteger(row.revision)||row.revision<1||row.revision>=Number.MAX_SAFE_INTEGER||!iso(row.updatedAt))return fail();
 return row;
}
const DAY=86400000,DEPTH=9,SPAN=4**DEPTH;
function day(at:string){if(!iso(at))return fail();const n=Math.floor((Date.parse(at)+10800000)/DAY);if(n<0||n>=SPAN)return fail('SETTLEMENT_ACCRUAL_INDEX_DATE_UNSUPPORTED');return n;}
const node=(level:number,slot:number)=>level===0?'HEAD':'NODE#'+level+'#'+slot;
/** Disjoint 4-way calendar segments cover any period with at most54 conditions.
 * Completion updates one ancestor per level, so unrelated days do not invalidate
 * a closed-period traversal. Boundary buckets may conservatively overlap hours.
 */
export function merchantAccrualRangeNodes(fromUtc:string,untilExclusiveUtc:string){
 if(!iso(fromUtc)||!iso(untilExclusiveUtc)||fromUtc>=untilExclusiveUtc)return fail();
 const first=day(fromUtc),last=day(new Date(Date.parse(untilExclusiveUtc)-1).toISOString()),nodes:string[]=[];
 function visit(level:number,slot:number,start:number,size:number){if(start>last||start+size<=first)return;if(first<=start&&start+size-1<=last){nodes.push(node(level,slot));return;}for(let c=0;c<4;c++)visit(level+1,slot*4+c,start+c*size/4,size/4);}
 visit(0,0,0,SPAN);if(nodes.length>54)return fail();return nodes;
}
export async function readMerchantAccrualRange(db:Pick<DynamoDBDocumentClient,'send'>,branchId:string,fromUtc:string,untilExclusiveUtc:string){
 if(!quoteEntityIdValid(branchId))return fail();return Promise.all(merchantAccrualRangeNodes(fromUtc,untilExclusiveUtc).map(async sk=>{const key={pk:merchantAccrualPartition(branchId),sk},row=validateMerchantAccrualIndexHead(await strongGet(db,MERCHANT_ACCRUAL_INDEX_TABLE,key),branchId,sk);return {key,row};}));
}
export function merchantAccrualRangeGuards(pins:{key:Row;row:Row|null}[]){return pins.map(p=>p.row?exactCheck(MERCHANT_ACCRUAL_INDEX_TABLE,p.key,p.row):{ConditionCheck:{TableName:MERCHANT_ACCRUAL_INDEX_TABLE,Key:p.key,ConditionExpression:'attribute_not_exists(pk)'}});}
/** Append alongside the existing completion transaction. No wallet/ledger changes.
 * The source row and all traversal counters commit with the original outcome.
 */
export async function prepareMerchantAccrualIndex(db:Pick<DynamoDBDocumentClient,'send'>,v:Parameters<typeof merchantAccrualIndexRow>[0],at=v.deliveredAt){
 if(!iso(at))return fail();const row=merchantAccrualIndexRow(v),n=day(v.deliveredAt);
 const heads=await Promise.all(Array.from({length:DEPTH+1},async(_,level)=>{
  const key={pk:row.pk,sk:node(level,Math.floor(n/4**(DEPTH-level)))},head=validateMerchantAccrualIndexHead(await strongGet(db,MERCHANT_ACCRUAL_INDEX_TABLE,key),v.branchId,key.sk);
  const next={...key,schemaVersion:1,kind:'MERCHANT_ACCRUAL_INDEX_HEAD',branchId:v.branchId,revision:(head?.revision??0)+1,updatedAt:at,retentionClass:'FINANCIAL_SETTLEMENT'};
  const condition=head?exactCheck(MERCHANT_ACCRUAL_INDEX_TABLE,key,head).ConditionCheck:{TableName:MERCHANT_ACCRUAL_INDEX_TABLE,Key:key,ConditionExpression:'attribute_not_exists(pk)'};
  const {Key:_key,...guard}=condition;return {Put:{...guard,Item:next}};
 }));
 return [{Put:{TableName:MERCHANT_ACCRUAL_INDEX_TABLE,Item:row,ConditionExpression:'attribute_not_exists(pk)'}},...heads];
}
export async function readMerchantAccrualIndexPage(db:Pick<DynamoDBDocumentClient,'send'>,v:{branchId:string;fromUtc:string;untilExclusiveUtc:string;key?:Row}){
 if(!quoteEntityIdValid(v.branchId)||!iso(v.fromUtc)||!iso(v.untilExclusiveUtc)||v.fromUtc>=v.untilExclusiveUtc)return fail();
 const pk=merchantAccrualPartition(v.branchId),validKey=(k:Row)=>k&&Object.keys(k).sort().join(',')==='pk,sk'&&k.pk===pk&&typeof k.sk==='string'&&k.sk.startsWith('DELIVERED#')&&k.sk>='DELIVERED#'+v.fromUtc&&k.sk<'DELIVERED#'+v.untilExclusiveUtc;
 if(v.key&&!validKey(v.key))return fail('SETTLEMENT_ACCRUAL_INDEX_CURSOR_INVALID');
 const page=await db.send(new QueryCommand({TableName:MERCHANT_ACCRUAL_INDEX_TABLE,ConsistentRead:true,KeyConditionExpression:'pk=:pk AND sk BETWEEN :from AND :until',ExpressionAttributeValues:{':pk':pk,':from':'DELIVERED#'+v.fromUtc,':until':'DELIVERED#'+v.untilExclusiveUtc},Limit:10,ScanIndexForward:true,...(v.key?{ExclusiveStartKey:v.key}:{})}));
 const seen=new Set();for(const row of page.Items||[]){validateMerchantAccrualIndexRow(row,v.branchId);if(!validKey({pk:row.pk,sk:row.sk})||seen.has(row.orderId))return fail();seen.add(row.orderId);}
 if(page.LastEvaluatedKey&&!validKey(page.LastEvaluatedKey))return fail();
 return {items:page.Items||[],nextKey:page.LastEvaluatedKey||null};
}
