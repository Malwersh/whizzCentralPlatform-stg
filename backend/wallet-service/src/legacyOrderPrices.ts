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
