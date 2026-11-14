import { GetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { quoteCanonical, quoteHash } from './deliveryQuoteRecord';
export type FinancialRow = Record<string, any>;
export const detach = <T>(v:T):T => JSON.parse(JSON.stringify(v));
export const equal = (a:unknown,b:unknown) => quoteCanonical(a)===quoteCanonical(b);
export async function strongGet(db:Pick<DynamoDBDocumentClient,'send'>,TableName:string,Key:FinancialRow) {
  return structuredClone((await db.send(new GetCommand({TableName,Key,ConsistentRead:true}))).Item ?? null);
}
export function exactCheck(TableName:string,Key:FinancialRow,saved:FinancialRow,fields=Object.keys(saved)) {
  const names:FinancialRow={},values:FinancialRow={},conditions:string[]=[];
  fields.forEach((field,i)=>{names['#f'+i]=field;if(saved[field]===undefined)conditions.push(`attribute_not_exists(#f${i})`);
    else {values[':v'+i]=structuredClone(saved[field]);conditions.push(`#f${i}=:v${i}`);}});
  return {ConditionCheck:{TableName,Key,ConditionExpression:conditions.join(' AND '),ExpressionAttributeNames:names,
    ...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};
}
export function updateChecked(check:FinancialRow,UpdateExpression:string,names:FinancialRow,values:FinancialRow) {
  const c=check.ConditionCheck;
  return {Update:{...c,UpdateExpression,ExpressionAttributeNames:{...c.ExpressionAttributeNames,...names},
    ExpressionAttributeValues:{...c.ExpressionAttributeValues,...values}}};
}

/** Retain a planner's original conditions without executing proposed writes.
 * Caller selects evidence operations only (never audit/event puts). Aliases that
 * belonged only to the discarded update are removed to keep DynamoDB valid.
 */
export function retainPlannedEvidence(operations:FinancialRow[]):FinancialRow[] {
 return operations.map(op=>{
  if(op.ConditionCheck)return detach(op);
  const w=op.Update??op.Put;if(!w||typeof w.ConditionExpression!=='string')throw Error('INVALID_FINANCIAL_EVIDENCE');
  const used:string[]=w.ConditionExpression.match(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g)??[];
  const names=Object.fromEntries(Object.entries(w.ExpressionAttributeNames??{}).filter(([k])=>used.includes(k)));
  const values=Object.fromEntries(Object.entries(w.ExpressionAttributeValues??{}).filter(([k])=>used.includes(k)));
  const key=w.Key??{pk:w.Item?.pk,sk:w.Item?.sk};if(Object.values(key).some(v=>typeof v!=='string'||!v))throw Error('INVALID_FINANCIAL_EVIDENCE');
  return {ConditionCheck:{TableName:w.TableName,Key:key,ConditionExpression:w.ConditionExpression,...(Object.keys(names).length?{ExpressionAttributeNames:names}:{}),...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})}};
 });
}

/** Type-aware idempotency token for DynamoDB transactions, including sets.
 * Signed quote/order digests retain their existing JSON contract.
 */
export function financialTransactionToken(value:unknown):string {
  function typed(v:any):any {
    if(v instanceof Set)return ['SET',[...v].map(typed).sort((a,b)=>quoteCanonical(a).localeCompare(quoteCanonical(b)))];
    if(Array.isArray(v))return ['LIST',v.map(typed)];
    if(v&&typeof v==='object')return ['MAP',Object.keys(v).sort().map(k=>[k,typed(v[k])])];
    return ['VALUE',v];
  }
  return quoteHash(typed(value)).slice(0,36);
}
