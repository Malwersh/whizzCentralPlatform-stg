import {FinancialRow as Row,detach,equal} from './driverFinancialTransaction';
import {quoteCanonical} from './deliveryQuoteRecord';
/** Compose read fences with an existing write to the same item. DynamoDB forbids
 * two operations on an item. Preserve both conditions, names and values without collisions.
 * Two mutations to one item are always a programming error, never silently merged.
 */
export function composeDispatchTransaction(operations:Row[],guards:Row[]):Row[] {
 const result:Row[]=detach(operations);
 for(const guard of detach(guards)){
  if(!guard.ConditionCheck)throw Error('INVALID_DISPATCH_FENCE');
  const g=guard.ConditionCheck;
  const existing=result.find(op=>{const q=op.ConditionCheck??op.Update??op.Delete;return q?.TableName===g.TableName&&equal(q.Key,g.Key);});
  if(!existing){if(result.some(op=>op.Put?.TableName===g.TableName&&Object.entries(g.Key).every(([k,v])=>equal(op.Put.Item[k],v))))throw Error('DISPATCH_FENCE_ON_INSERT');result.push(guard);continue;}
  const q=existing.ConditionCheck??existing.Update??existing.Delete;
  let expression=g.ConditionExpression;const names:Row={},values:Row={};let n=0;
  const used=new Set([...Object.keys(q.ExpressionAttributeNames??{}),...Object.keys(q.ExpressionAttributeValues??{})]);
  const replacements:Row={};
  for(const [map,prefix,out]of [[g.ExpressionAttributeNames,'#',names],[g.ExpressionAttributeValues,':',values]] as any){for(const [token,value]of Object.entries(map??{})){let next:string;do{next=prefix+'d'+n++;}while(used.has(next));used.add(next);replacements[token]=next;out[next]=value;}}
  expression=expression.replace(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g,(t:string)=>replacements[t]??t);
  q.ConditionExpression=[q.ConditionExpression,expression].filter(Boolean).map(e=>/\bOR\b/.test(e)?'('+e+')':e).join(' AND ');
  q.ExpressionAttributeNames={...q.ExpressionAttributeNames,...names};q.ExpressionAttributeValues={...q.ExpressionAttributeValues,...values};
  if(!Object.keys(q.ExpressionAttributeNames).length)delete q.ExpressionAttributeNames;
  if(!Object.keys(q.ExpressionAttributeValues).length)delete q.ExpressionAttributeValues;
  if(Buffer.byteLength(q.ConditionExpression)>3900)throw Error('DISPATCH_FENCE_TOO_LARGE');
 }
 const ids=result.map(op=>{const q=op.Put??op.Update??op.Delete??op.ConditionCheck;const key=q.Key??(['WizzDispatchJobs_staging','WaveOffers_staging'].includes(q.TableName)?{orderId:q.Item.orderId,SK:q.Item.SK}:q.Item);return q.TableName+':'+quoteCanonical(key);});
 if(new Set(ids).size!==ids.length||result.length>100||Buffer.byteLength(JSON.stringify(result))>3500000)throw Error('DISPATCH_TRANSACTION_TOO_LARGE');
 return result;
}
