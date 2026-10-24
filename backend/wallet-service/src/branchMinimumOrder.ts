/** Existing branch minimum_order is whole IQD. Absence/null/zero means no minimum.
 * No inferred platform default; fees and discounts never contribute to goods gross. */
export function minimumOrderIqd(branch:Record<string,any>):number|null{
 const value=branch.minimum_order;
 if(value==null||value===0)return null;
 if(!Number.isSafeInteger(value)||value<0||value>1000000000)throw Object.assign(Error('INVALID_MINIMUM_ORDER'),{code:'INVALID_MINIMUM_ORDER',statusCode:409});
 return value;
}
export function assertMinimumOrder(branch:Record<string,any>,goodsGrossMinor:number){
 const minimum=minimumOrderIqd(branch);
 if(minimum!==null&&goodsGrossMinor<minimum*1000)throw Object.assign(Error('MINIMUM_ORDER_NOT_MET'),{code:'MINIMUM_ORDER_NOT_MET',statusCode:409,minimumOrderAmountIqd:minimum});
}
