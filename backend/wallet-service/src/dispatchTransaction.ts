import {FinancialRow as Row,detach,equal} from './driverFinancialTransaction';
import {quoteCanonical} from './deliveryQuoteRecord';
/** Compose read fences with an existing write to the same item. DynamoDB forbids
 * two operations on an item. Preserve both conditions, names and values without collisions.
 * Two mutations to one item are always a programming error, never silently merged.
 */
// Remove only provably identical conjuncts. A real order can contain many
// fields; repeating the same read predicate across adapters can exceed DynamoDB's
// 300-operator limit. OR/BETWEEN and unknown atoms remain untouched.
function conjunction(value:string):string[]|null {
 if(/\b(?:OR|BETWEEN|NOT)\b/.test(value))return null;
 let text=value.trim();
 while(text.startsWith('(')){
  let depth=0,end=-1;for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')'&&--depth===0){end=i;break;}}
  if(end!==text.length-1)break;text=text.slice(1,-1).trim();
 }
 let depth=0,start=0;const parts:string[]=[];
 for(let i=0;i<text.length;i++){if(text[i]==='(')depth++;if(text[i]===')')depth--;if(depth<0)return null;if(depth===0&&text.slice(i,i+5)===' AND '){const sub=conjunction(text.slice(start,i));if(!sub)return null;parts.push(...sub);start=i+5;i+=4;}}
 if(depth!==0)return null;if(start){const sub=conjunction(text.slice(start));return sub?[...parts,...sub]:null;}return text?[text]:null;
}
function atomIdentity(term:string,check:Row):string|null {
 const field=(token:string)=>token.startsWith('#')?check.ExpressionAttributeNames?.[token]:token;
 const absence=term.match(/^attribute_(not_)?exists\(\s*(#[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*\)$/);
 if(absence){const name=field(absence[2]);return typeof name==='string'?quoteCanonical([absence[1]?'absent':'present',name]):null;}
 const equality=term.match(/^(#[A-Za-z0-9_]+|[A-Za-z0-9_]+)\s*=\s*(:[A-Za-z0-9_]+)$/);
 if(!equality||typeof field(equality[1])!=='string'||!Object.prototype.hasOwnProperty.call(check.ExpressionAttributeValues??{},equality[2]))return null;
 return quoteCanonical(['equal',field(equality[1]),check.ExpressionAttributeValues[equality[2]]]);
}
export function composeDispatchTransaction(operations:Row[],guards:Row[]):Row[] {
 const result:Row[]=detach(operations);
 for(const guard of detach(guards)){
  if(!guard.ConditionCheck)throw Error('INVALID_DISPATCH_FENCE');
  const g=guard.ConditionCheck;
  const existing=result.find(op=>{const q=op.ConditionCheck??op.Update??op.Delete;return q?.TableName===g.TableName&&equal(q.Key,g.Key);});
  if(!existing){if(result.some(op=>op.Put?.TableName===g.TableName&&Object.entries(g.Key).every(([k,v])=>equal(op.Put.Item[k],v))))throw Error('DISPATCH_FENCE_ON_INSERT');result.push(guard);continue;}
  const q=existing.ConditionCheck??existing.Update??existing.Delete;
  let expression=g.ConditionExpression;
  const prior=conjunction(q.ConditionExpression??''),incoming=conjunction(expression);
  if(prior&&incoming){const seen=new Set(prior.map(t=>atomIdentity(t,q)).filter(Boolean));const retained=incoming.filter(t=>{const identity=atomIdentity(t,g);if(identity&&seen.has(identity))return false;if(identity)seen.add(identity);return true;});if(!retained.length)continue;expression=retained.join(' AND ');}
  const referenced=new Set(expression.match(/#[A-Za-z0-9_]+|:[A-Za-z0-9_]+/g)??[]);
  const names:Row={},values:Row={};let n=0;
  const used=new Set([...Object.keys(q.ExpressionAttributeNames??{}),...Object.keys(q.ExpressionAttributeValues??{})]);
  const replacements:Row={};
  for(const [map,prefix,out]of [[g.ExpressionAttributeNames,'#',names],[g.ExpressionAttributeValues,':',values]] as any){for(const [token,value]of Object.entries(map??{})){if(!referenced.has(token))continue;let next:string;do{next=prefix+'d'+n++;}while(used.has(next));used.add(next);replacements[token]=next;out[next]=value;}}
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
