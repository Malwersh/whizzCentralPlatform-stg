'use strict';
// Redemption terms only. Accounting funding policies are deliberately not evaluated here.
const types = new Set(['percentage', 'fixedAmount', 'freeDelivery']);
const audiences = new Set(['all', 'registered', 'guests', 'new', 'returning', 'vip', 'inactive']);
const merchantAliases = [['validFrom','valid_from'],['validTo','valid_to'],['minimumOrderAmount','minimum_order_amount'],['usageLimit','usage_limit'],['usageCount','usage_count'],['type','discountType'],['value','discountValue']];
const platformAliases = [['title','name'],['type','discountType'],['value','discountValue'],['minOrderAmount','minOrderValue'],['usageLimit','limit'],['usage','currentUsage'],['validFrom','startDate'],['validTo','endDate'],['maxDiscountAmount','maxDiscount']];
const fail = code => { throw Object.assign(Error(code), {status:409,statusCode:409}); };
function type(value) { return ({fixed:'fixedAmount',fixed_amount:'fixedAmount',free_delivery:'freeDelivery','free-delivery':'freeDelivery'})[value] || value; }
// Historical editors submitted Baghdad wall-clock timestamps without a timezone.
// Canonical writes use UTC; reading legacy microseconds does not mutate stored records.
function instant(value) {
 if(typeof value!=='string')return value;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
 if(!match)return value;
 const day=new Date(Date.UTC(+match[1],+match[2]-1,+match[3]));
 if(day.toISOString().slice(0,10)!==value.slice(0,10)||+match[4]>23||+match[5]>59||+(match[6]||0)>59)return value;
 const canonical=match[1]+'-'+match[2]+'-'+match[3]+'T'+match[4]+':'+match[5]+':'+(match[6]||'00')+'.'+(match[7]||'').padEnd(3,'0').slice(0,3)+(match[8]||'+03:00');
 const time=Date.parse(canonical);return Number.isFinite(time)?new Date(time).toISOString():value;
}
function patchTerms(before, patch, source) {
 const next={...(before||{}),...patch};
 for(const group of source==='merchant'?merchantAliases:platformAliases) {
  const supplied=group.filter(k=>Object.hasOwn(patch,k));
  const fields=supplied.length?supplied:group.filter(k=>next[k]!==undefined&&next[k]!==null&&next[k]!=='');
  if(!fields.length)continue;
  const normalize=v=>['validFrom','validTo'].includes(group[0])?instant(v):group[0]==='type'?type(v):group[0]==='usageLimit'&&(v===0||v===null)?null:v;
  const value=normalize(next[fields[0]]);
  if(fields.some(k=>normalize(next[k])!==value))fail('DISCOUNT_ALIASES_CONFLICT');
  for(const k of group)next[k]=['validFrom','validTo'].includes(group[0])?value:next[fields[0]];
 }
 if(source==='platform'&&next.code!==undefined){if(typeof next.code!=='string')fail('CAMPAIGN_CODE_INVALID');next.code=next.code.trim().toUpperCase();if(next.code&&!/^[A-Z0-9_-]{1,40}$/.test(next.code))fail('CAMPAIGN_CODE_INVALID');}
 if(Object.hasOwn(patch,'status')&&(source==='platform'||Object.hasOwn(next,'isActive')))next.isActive=patch.status==='active';
 return next;
}
function supported(raw) {
 if(raw.calculationMode!==undefined&&!['order','perItem'].includes(raw.calculationMode))return false;
 if(raw.calculationMode==='perItem'&&(!['percentage','fixedAmount'].includes(type(raw.type||raw.discountType))||raw.applicability!=='specificItems'||
  !Array.isArray(raw.applicable_item_ids)||raw.applicable_item_ids.length>40||
  Number(raw.minimumOrderAmount??raw.minimum_order_amount??0)!==0||raw.maxDiscountAmount!=null||raw.maxDiscount!=null||!universal(raw)))return false;
 const segments=raw.customerSegments||['all'];
 if(['isActive','singleUse','firstOrderOnly','applicableToAll','stackable'].some(k=>raw[k]!==undefined&&typeof raw[k]!=='boolean'))return false;
 if(['targetRegionIds','targetRestaurants','allowedBusinessIds','businessIds','customerIds','targetSegments','occasions','applicable_item_ids','applicable_category_ids'].some(k=>raw[k]!==undefined&&(!Array.isArray(raw[k])||raw[k].some(v=>typeof v!=='string'||!v||v.length>150))))return false;
 // Scoped offers require at least one usable selection before any writer saves them.
 const selection=raw.applicability==='specificItems'?'applicable_item_ids':raw.applicability==='specificCategories'?'applicable_category_ids':null;
 if(selection&&(!Array.isArray(raw[selection])||!raw[selection].length||raw[selection].some(v=>!v.trim())))return false;
 if(raw.perCustomerLimit!=null&&(!Number.isSafeInteger(raw.perCustomerLimit)||raw.perCustomerLimit<1))return false;
 return types.has(type(raw.type||raw.discountType))&&Array.isArray(segments)&&segments.every(s=>audiences.has(s))&&
  !raw.targetSegments?.length&&!raw.occasions?.length&&raw.stackable!==true&&
  !Object.keys(raw.conditionalParameters||raw.conditional_parameters||{}).length;
}
function universal(raw) {
 return !raw.firstOrderOnly&&!['first-order','first_order','new-customer','new_customer'].includes(raw.campaignType)&&
 !raw.singleUse&&raw.perCustomerLimit==null&&!raw.customerIds?.length&&!raw.targetRegionIds?.length&&
 !raw.targetLocation&&!raw.targetRestaurants?.length&&!raw.allowedBusinessIds?.length&&!raw.businessIds?.length&&
 raw.applicableToAll!==false&&(!raw.target||['all','All regions','All Customers'].includes(raw.target))&&
 !(raw.customerSegments||[]).some(s=>!['all','guests'].includes(s));
}
function removed(raw){return raw.isDeleted===true||raw.deletedAt!=null||raw.deletionStatus!=null||raw.deletionRequestId!=null;}
// Plain-product pricing cannot authorize option/variant prices. Empty groups are
// harmless; a populated selection (even a free option) needs catalog support.
function discountOptionSelection(item){
 const populated=v=>v!=null&&v!==''&&v!==false&&(!Array.isArray(v)||v.length>0)&&(!(typeof v==='object'&&!Array.isArray(v))||Object.values(v).some(populated));
 if(item.modifiers!=null&&!Array.isArray(item.modifiers)||['modifiers','variantId','variant_id','sizeId','size_id'].some(k=>populated(item[k])))fail('UNSUPPORTED_DISCOUNT_ITEMS');
 let selection=null;
 for(const key of ['selectedOptions','selected_options','customizations']){
  const value=item[key];if(!populated(value)&&!(value&&typeof value==='object'&&!Array.isArray(value)))continue;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>20)fail('UNSUPPORTED_DISCOUNT_ITEMS');
  const normalized={};
  for(const group of Object.keys(value).sort()){
   const ids=value[group];
   if(!/^[A-Za-z0-9_-]{1,100}$/.test(group)||!Array.isArray(ids)||ids.length>40||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))||new Set(ids).size!==ids.length)fail('UNSUPPORTED_DISCOUNT_ITEMS');
   if(ids.length)Object.defineProperty(normalized,group,{value:[...ids].sort(),enumerable:true});
  }
  if(selection&&JSON.stringify(selection)!==JSON.stringify(normalized))fail('UNSUPPORTED_DISCOUNT_ITEMS');
  selection=normalized;
 }
 return selection||{};
}
function discountGoodsSelection(item){
 const selectedOptions=discountOptionSelection(item);
 return {productId:item.id||item.productId||item.itemId,quantity:item.quantity,...(Object.keys(selectedOptions).length?{selectedOptions}:{})};
}
function hasDiscountCustomizations(items){
 return Array.isArray(items)&&items.some(item=>{try{discountOptionSelection(item);return false;}catch{return true;}});
}

module.exports={patchTerms,supported,universal,removed,type,audiences,instant,hasDiscountCustomizations,discountOptionSelection,discountGoodsSelection};
