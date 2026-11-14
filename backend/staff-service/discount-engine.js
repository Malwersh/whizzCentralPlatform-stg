const {patchTerms,supported,removed,type:canonicalType}=require('./discount-contract');
// Shared discount validation/calculation engine for WizzUser backend.
// Canonical redemption calculator; distributed by sync-discount-runtime.cjs.
// All monetary inputs and outputs are in IQD fils (dinars x 1000).

// The table stores snake_case (valid_from, minimum_order_amount, ...);
// reading camelCase names directly would silently disable those checks.
function normalizeDiscount(d) {
    if (!d) return d;
    d=patchTerms(null,d,'merchant');
    d.type=canonicalType(d.type||d.discountType);
    return {
        ...d,
        validFrom: d.validFrom || d.valid_from,
        validTo: d.validTo || d.valid_to,
        minimumOrderAmount: d.minimumOrderAmount ?? d.minimum_order_amount ?? 0,
        usageLimit: (d.usageLimit ?? d.usage_limit ?? null) === 0 ? null : (d.usageLimit ?? d.usage_limit ?? null),
        usageCount: d.usageCount ?? d.usage_count ?? 0,
        conditionalParameters: d.conditionalParameters || d.conditional_parameters || {},
    };
}

// Returns { valid: true } or { valid: false, message }
function decimalThousand(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('INVALID_DISCOUNT_AMOUNT');
    const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(value));
    if (!m) throw Error('INVALID_DISCOUNT_AMOUNT');
    const n = BigInt(m[1]) * 1000n + BigInt((m[2] || '').padEnd(3, '0'));
    if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('INVALID_DISCOUNT_AMOUNT');
    return Number(n);
}
function validDate(value) {
    if (!value) return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) || !Number.isFinite(Date.parse(value))) return false;
    const [year,month,day] = value.slice(0,10).split('-').map(Number);
    const date=new Date(Date.UTC(year,month-1,day));
    return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day;
}
function validShape(d, total) {
    try { decimalThousand(d.value); decimalThousand(d.minimumOrderAmount); } catch { return false; }
    if (!d || !Number.isSafeInteger(total) || total < 0 ||
        !['percentage','fixedAmount','freeDelivery'].includes(d.type) ||
        !['allItems','minimumOrder','specificItems','specificCategories'].includes(d.applicability || 'allItems') ||
        typeof d.value !== 'number' || !Number.isFinite(d.value) || d.value < 0 ||
        (d.type !== 'freeDelivery' && d.value <= 0) ||
        (d.type === 'percentage' && d.value > 100) ||
        !Number.isFinite(d.minimumOrderAmount) || d.minimumOrderAmount < 0 ||
        !Number.isSafeInteger(d.usageCount) || d.usageCount < 0 ||
        (d.usageLimit !== null && (!Number.isSafeInteger(d.usageLimit) || d.usageLimit < 0)) ||
        [d.validFrom,d.validTo].some(v => !validDate(v)) ||
        (d.validFrom && d.validTo && Date.parse(d.validFrom) >= Date.parse(d.validTo))) return false;
    try{if(d.maxDiscountAmount!=null)decimalThousand(d.maxDiscountAmount);if(d.maxDiscount!=null)decimalThousand(d.maxDiscount);}catch{return false;}
    if(d.maxDiscountAmount!=null&&d.maxDiscount!=null&&d.maxDiscountAmount!==d.maxDiscount)return false;
    return true;
}
function validateDiscount(discount, orderTotalFils) {
    if (!validShape(discount, orderTotalFils)) return {valid:false,message:'Unsupported or invalid discount'};
    if (removed(discount)||!supported(discount)||discount.isActive===false||discount.status !== 'active') {
        return { valid: false, message: 'Discount is not active' };
    }

    const now = new Date();
    if (discount.validFrom && now < new Date(discount.validFrom)) {
        return { valid: false, message: 'Discount is not valid yet' };
    }
    if (discount.validTo && now >= new Date(discount.validTo)) {
        return { valid: false, message: 'Discount has expired' };
    }

    const minOrderFils = decimalThousand(discount.minimumOrderAmount);
    if (orderTotalFils < minOrderFils) {
        return {
            valid: false,
            message: `Order must be at least ${discount.minimumOrderAmount} IQD`
        };
    }

    if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) {
        return { valid: false, message: 'Discount usage limit reached' };
    }

    return { valid: true };
}

// items: [{ id/itemId, categoryId, price (fils), quantity }]
function calculateUncappedAmount(discount, orderTotalFils, items, deliveryFeeFils, roundFils = true) {
    let discountableAmount = 0;

    switch (discount.applicability) {
        case 'allItems':
            discountableAmount = orderTotalFils;
            break;
        case 'specificItems':
            discountableAmount = (items || [])
                .filter(item => (discount.applicable_item_ids || []).includes(item.itemId || item.id))
                .reduce((sum, item) => sum + (item.price * item.quantity), 0);
            break;
        case 'specificCategories':
            discountableAmount = (items || [])
                .filter(item => (discount.applicable_category_ids || []).includes(item.categoryId))
                .reduce((sum, item) => sum + (item.price * item.quantity), 0);
            break;
        case 'minimumOrder':
            discountableAmount = orderTotalFils;
            break;
        case undefined:
            discountableAmount = orderTotalFils; break;
        default: throw Error('UNSUPPORTED_DISCOUNT');
    }

    switch (discount.type) {
        case 'percentage':
            // Clamp: never discount more than the discountable amount
            return Math.min(Number((BigInt(discountableAmount) * BigInt(decimalThousand(discount.value)) + (roundFils ? 50000n : 0n)) / 100000n), discountableAmount);
        case 'fixedAmount':
            // value is stored in dinars by the merchant app
            return Math.min(decimalThousand(discount.value), discountableAmount);
        case 'freeDelivery':
            return Math.max(0, deliveryFeeFils || 0);
        default:
            return 0;
    }
}

function calculateAmount(discount, total, items, deliveryFee, roundFils) {
 const amount=calculateUncappedAmount(discount,total,items,deliveryFee,roundFils);
 const cap=discount.maxDiscountAmount??discount.maxDiscount;
 if(discount.maxDiscountAmount!=null&&discount.maxDiscount!=null&&discount.maxDiscountAmount!==discount.maxDiscount)throw Error('INVALID_DISCOUNT_CAP');
 return cap==null?amount:Math.min(amount,decimalThousand(cap));
}

function calculateDiscountAmount(discount, total, items, deliveryFee) {
 return calculateAmount(discount,total,items,deliveryFee,true);
}

// Customer checkout policy: multiples of 250 IQD, rounded down after eligibility and caps.
// Keep the fils calculator above precise for internal calculations and legacy snapshots.
function calculateCheckoutDiscountAmount(discount, total, items, deliveryFee) {
 if(discount.calculationMode==='perItem') {
  if(!supported(discount))throw Error('INVALID_ITEM_DISCOUNT');
  let saving=0;
  for(const item of items||[]) {
   if(!(discount.applicable_item_ids||[]).includes(item.itemId||item.id))continue;
   if(!Number.isSafeInteger(item.price)||item.price<0||!Number.isSafeInteger(item.quantity)||item.quantity<1)throw Error('INVALID_ITEM_DISCOUNT');
   const unit=calculateAmount({...discount,calculationMode:'order'},item.price,[{...item,quantity:1}],0,false);
   saving+=Number(BigInt(unit)/250000n*250000n)*item.quantity;
   if(!Number.isSafeInteger(saving))throw Error('INVALID_ITEM_DISCOUNT');
  }
  return saving;
 }
 // Floor percentage arithmetic first: rounding a fractional fils up can cross
 // a whole-IQD boundary and exceed the exact calculated saving.
 const amount=calculateAmount(discount,total,items,deliveryFee,false);
 if(!Number.isSafeInteger(amount)||amount<0)throw Error('INVALID_DISCOUNT_AMOUNT');
 return Number(BigInt(amount)/250000n*250000n);
}

// Platform promos (WizzCentral_Platform_Discounts) are written by the
// central platform with duplicated legacy field names (type/discountType,
// usage/currentUsage, minOrderAmount/minOrderValue, ...). Unify them here.
function normalizePlatformPromo(d) {
    if (!d) return d;
    d=patchTerms(null,d,'platform');
    const rawType = String(d.type || d.discountType || 'percentage').trim().toLowerCase();
    let normalizedType = 'percentage';
    if (rawType === 'fixed_amount' || rawType === 'fixed' || rawType === 'fixedamount') {
        normalizedType = 'fixedAmount';
    } else if (rawType === 'free_delivery' || rawType === 'free-delivery' || rawType === 'freedelivery') {
        normalizedType = 'freeDelivery';
    } else if (rawType === 'percentage') {
        normalizedType = 'percentage';
    } else {
        normalizedType = d.type || d.discountType || 'percentage';
    }

    return {
        ...d,
        type: normalizedType,
        value: Number(d.value ?? d.discountValue),
        usageCount: d.usage ?? d.currentUsage ?? 0,
        usageLimit: (d.usageLimit ?? d.limit ?? null) === 0 ? null : (d.usageLimit ?? d.limit ?? null),
        minimumOrderAmount: Number(d.minOrderAmount ?? d.minOrderValue ?? 0),
        validFrom: d.validFrom || d.startDate || '',
        validTo: d.validTo || d.endDate || '',
    };
}

// Returns { valid: true } or { valid: false, message }
function validatePlatformPromo(promo, orderTotalFils) {
    if (removed(promo)||!supported(promo)||!validShape(promo, orderTotalFils) ||
        (promo.usage !== undefined && promo.currentUsage !== undefined && promo.usage !== promo.currentUsage))
        return {valid:false,message:'Unsupported or invalid promo'};
    const statusOk = (promo.status === 'active' || (promo.status === undefined && promo.isActive === true)) && promo.isActive !== false;
    if (!statusOk) {
        return { valid: false, message: 'Promo code is not active' };
    }

    const now = new Date();
    if (promo.validFrom && now < new Date(promo.validFrom)) {
        return { valid: false, message: 'Promo code is not valid yet' };
    }
    if (promo.validTo && now >= new Date(promo.validTo)) {
        return { valid: false, message: 'Promo code has expired' };
    }

    const minOrderFils = decimalThousand(promo.minimumOrderAmount);
    if (orderTotalFils < minOrderFils) {
        return {
            valid: false,
            message: `Order must be at least ${promo.minimumOrderAmount} IQD`
        };
    }

    if (promo.usageLimit !== null && promo.usageCount >= promo.usageLimit) {
        return { valid: false, message: 'Promo code usage limit reached' };
    }

    return { valid: true };
}

module.exports = {
    validShape,
    decimalThousand,
    normalizeDiscount,
    validateDiscount,
    calculateDiscountAmount,
    calculateCheckoutDiscountAmount,
    normalizePlatformPromo,
    validatePlatformPromo,
};
