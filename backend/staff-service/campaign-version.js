'use strict';
// Canonical campaign-content version. Usage/state updates retain approved terms; changed terms revoke the current funding binding.
const {createHash}=require('node:crypto');
const transient=new Set(['version','status','isActive','autoActivate','updatedAt','updated_at','createdAt','created_at','createdBy','updatedBy','usage','currentUsage','usage_count','usageCount','fundingPolicyId','fundingPolicyVersion','revision']);
const pinned=['version','fundingPolicyId','fundingPolicyVersion','legalHold','retentionHold','isDeleted','deletedAt','deletionStatus'];
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex');
const fail=code=>{throw Object.assign(Error(code),{status:409,statusCode:409});};
function validVersion(row){if(row.version!==undefined&&(!Number.isSafeInteger(row.version)||row.version<1))fail('CAMPAIGN_VERSION_INVALID');return row.version;}
function revision(row){return digest(row);}
function versioned(before,after){
 const next={...after};if(!before){next.version=1;delete next.fundingPolicyId;delete next.fundingPolicyVersion;return next;}
 if(before.discountId!==after.discountId||before.businessId!==after.businessId)fail('CAMPAIGN_SCOPE_INVALID');
 const previous=validVersion(before),terms=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!transient.has(k)));
 const changed=digest(terms(before))!==digest(terms(after));
 if(changed&&previous===Number.MAX_SAFE_INTEGER)fail('CAMPAIGN_VERSION_EXHAUSTED');
 next.version=previous===undefined?1:previous+(changed?1:0);
 if(changed||previous===undefined){delete next.fundingPolicyId;delete next.fundingPolicyVersion;}else for(const k of ['fundingPolicyId','fundingPolicyVersion']){if(before[k]===undefined)delete next[k];else next[k]=before[k];}
 return next;
}
function fence(row,prefix='cv'){
 const names={},values={},parts=[];for(const [i,k]of [...new Set([...Object.keys(row),...pinned])].entries()){
  const n='#'+prefix+i,v=':'+prefix+i;names[n]=k;if(row[k]===undefined)parts.push('attribute_not_exists('+n+')');else{values[v]=row[k];parts.push(n+'='+v);}
 }
 const ConditionExpression=parts.join(' AND ');if(Buffer.byteLength(ConditionExpression)>3900)fail('CAMPAIGN_RECORD_TOO_LARGE');
 return {ConditionExpression,ExpressionAttributeNames:names,...(Object.keys(values).length?{ExpressionAttributeValues:values}:{})};
}
function appendCondition(base,op){
 if(!op.ConditionExpression)return base;
 const condition=op.ConditionExpression,tokens=new Set(condition.match(/[#:]\w+/g)||[]),names=Object.fromEntries(Object.entries(op.ExpressionAttributeNames||{}).filter(([k])=>tokens.has(k))),values=Object.fromEntries(Object.entries(op.ExpressionAttributeValues||{}).filter(([k])=>tokens.has(k)));
 const mergedNames={...base.ExpressionAttributeNames,...names},mergedValues={...base.ExpressionAttributeValues,...values};return {ConditionExpression:'('+base.ConditionExpression+') AND ('+condition+')',...(Object.keys(mergedNames).length?{ExpressionAttributeNames:mergedNames}:{}),...(Object.keys(mergedValues).length?{ExpressionAttributeValues:mergedValues}:{})};
}
function applySet(row,op){
 if(!/^SET\s+/i.test(op.UpdateExpression||'')||/\b(REMOVE|ADD|DELETE)\b/.test(op.UpdateExpression))fail('CAMPAIGN_WRITE_UNSUPPORTED');
 const next={...row},field=s=>s.startsWith('#')?op.ExpressionAttributeNames?.[s]:s,value=s=>{if(!Object.prototype.hasOwnProperty.call(op.ExpressionAttributeValues||{},s))fail('CAMPAIGN_WRITE_UNSUPPORTED');return op.ExpressionAttributeValues[s];};
 for(const expression of op.UpdateExpression.replace(/^SET\s+/i,'').split(',')){
  const m=/^\s*([#\w]+)\s*=\s*(:\w+|[#\w]+\s*\+\s*:\w+)\s*$/.exec(expression);if(!m)fail('CAMPAIGN_WRITE_UNSUPPORTED');const k=field(m[1]);if(!k||['version','fundingPolicyId','fundingPolicyVersion','discountId','businessId'].includes(k))fail('CAMPAIGN_WRITE_FORBIDDEN');
  if(m[2].startsWith(':'))next[k]=value(m[2]);else{const [a,b]=m[2].split('+').map(s=>s.trim()),n=row[field(a)]+value(b);if(!Number.isSafeInteger(n)||n<0)fail('CAMPAIGN_COUNTER_INVALID');next[k]=n;}
 }return next;
}
/** Called inside the existing verified merchant lifecycle wrapper. The surrounding transaction supplies deletion/ownership guards. */
async function ownerOperation(raw,item,businessId,sdk){
 const op=item.Put||item.Update||item.Delete;if(!op||op.TableName!=='WhizzMerchants_Discounts')return item;
 if(item.Put){if(op.Item.businessId!==businessId)fail('CAMPAIGN_SCOPE_INVALID');if(['version','fundingPolicyId','fundingPolicyVersion'].some(k=>op.Item[k]!==undefined))fail('CAMPAIGN_WRITE_FORBIDDEN');return {Put:{TableName:op.TableName,Item:versioned(null,op.Item),...appendCondition({ConditionExpression:'attribute_not_exists(discountId)'},op)}};}
 const row=(await raw.send(new sdk.GetCommand({TableName:op.TableName,Key:op.Key,ConsistentRead:true}))).Item;if(!row||row.businessId!==businessId)fail('CAMPAIGN_UNAVAILABLE');validVersion(row);if(sdk.expectedRevision!==undefined&&sdk.expectedRevision!==revision(row))fail('VERSION_OR_STATE_CONFLICT');
 if(row.legalHold===true||row.retentionHold===true)fail('CAMPAIGN_RETENTION_HOLD');
 const condition=appendCondition(fence(row),op);if(item.Delete)return {Delete:{TableName:op.TableName,Key:op.Key,...condition}};
 return {Put:{TableName:op.TableName,Item:versioned(row,applySet(row,op)),...condition}};
}
module.exports={versioned,validVersion,revision,fence,digest,ownerOperation};
